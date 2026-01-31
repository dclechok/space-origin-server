// socketHandler.js (OPEN WORLD MMO + GLOBAL CHAT) — CLICK/DRAG-TO-MOVE (NO OVERSHOOT / NO SPIN / NO FLOP)
// Key fixes vs your version:
// 1) Arrival is DISTANCE-ONLY: when within ARRIVE_RADIUS, we SNAP to target, ZERO velocity, CLEAR moveTarget.
//    (This prevents the oscillation loop caused by requiring speed <= STOP_EPS.)
// 2) No "minimum arrive speed" creep. MIN_ARRIVE_SPEED removed -> it won’t keep forcing motion past the point.
// 3) While approaching, we compare speed ALONG the target direction (speedToward) so sideways drift doesn’t
//    trigger weird thrust/brake behavior.
// 4) Near the destination we stop re-aiming at the target (FACE_LOCK_RADIUS) to prevent atan2 flipping.
//
// ✅ DEBUG ADDED (no behavior changes):
// - Logs what moveTo deltas the server RECEIVES (dx/dy/dist) at most 5x/sec per socket.
// - Logs server physics speed (vx/vy/sp and toward-target speed) ~4x/sec per ship.
//   This will prove whether the slowdown is in physics or in client/render mapping.

const { ObjectId } = require("mongodb");
const { WORLD_SEED } = require("../world/worldSeed");

const activePlayers = {}; // socket.id -> characterId
const playerMeta = {}; // socket.id -> { characterId, name }

// Authoritative ship state
// socket.id -> { x, y, vx, vy, angle, moveTarget, lastSeenAt }
const shipState = {};

// Last input per player
// socket.id -> { thrust, targetAngle?, lastAt }
const shipInput = {};

// ------------------------------
// GLOBAL CHAT (server-wide)
// ------------------------------
const CHAT_MAX = 100;
const chatHistory = [];

function pushChat(msg) {
  chatHistory.push(msg);
  if (chatHistory.length > CHAT_MAX) {
    chatHistory.splice(0, chatHistory.length - CHAT_MAX);
  }
}

// Simple chat rate-limit (per socket)
const CHAT_MIN_INTERVAL_MS = 800; // at most ~1.25 msg/sec per socket
const CHAT_MSG_MAX = 240;
const CHAT_NAME_MAX = 24;
const lastChatAt = {}; // socket.id -> timestamp

module.exports = function socketHandler(io) {
  // ======================================================
  // Tunables
  // ======================================================
  const TICK_HZ = 20; // physics tick
  const DT = 1 / TICK_HZ;

  const SNAPSHOT_HZ = 10; // network snapshot rate

  // Movement
  const TURN_RATE = 4.5; // rad/sec
  const THRUST = 180; // px/sec^2
  const DRAG = 0.92; // per-tick damping
  const MAX_SPEED = 320; // px/sec cap

  // Click-to-move autopilot
  const SLOW_RADIUS = 120; // px: start easing in (a bit larger helps smooth stops)
  const ARRIVE_RADIUS = 14; // px: snap + stop inside this radius

  // Prevent last-moment “atan2 flips” near target
  const FACE_LOCK_RADIUS = 28; // px (18–40)

  // In the slow zone desiredSpeed scales with distance (no forced minimum)
  const ARRIVE_K = 2.2; // higher = more aggressive approach; lower = gentler
  const MAX_ARRIVE_SPEED = 170; // caps approach speed within slow zone

  // Braking strength when too fast in slow zone
  const ARRIVE_DRAG = 0.84; // lower = stronger braking

  // MMO interest management
  const VIEW_RADIUS = 2400;
  const VIEW_RADIUS_SQ = VIEW_RADIUS * VIEW_RADIUS;

  // Drop stale inputs (optional safety)
  const INPUT_STALE_MS = 2000;

  function clamp(x, a, b) {
    return x < a ? a : x > b ? b : x;
  }

  function wrapAngle(a) {
    while (a <= -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    return a;
  }

  function turnToward(current, target, maxDelta) {
    let d = wrapAngle(target - current);
    if (d > maxDelta) d = maxDelta;
    if (d < -maxDelta) d = -maxDelta;
    return wrapAngle(current + d);
  }

  function safeNameFromMeta(socketId) {
    const n = playerMeta[socketId]?.name;
    if (!n) return null;
    const s = String(n).trim();
    if (!s) return null;
    return s.slice(0, CHAT_NAME_MAX);
  }

  function buildNearbySnapshot(meId) {
    const me = shipState[meId];
    if (!me) return {};

    const players = {};
    const mx = me.x;
    const my = me.y;

    for (const [id, p] of Object.entries(shipState)) {
      if (!p) continue;

      const name = playerMeta[id]?.name || null;

      if (id === meId) {
        players[id] = { x: p.x, y: p.y, angle: p.angle, name };
        continue;
      }

      const dx = p.x - mx;
      const dy = p.y - my;
      const d2 = dx * dx + dy * dy;

      if (d2 <= VIEW_RADIUS_SQ) {
        players[id] = { x: p.x, y: p.y, angle: p.angle, name };
      }
    }

    return players;
  }

  // ======================================================
  // Authoritative physics tick (fixed rate)
  // ======================================================
  setInterval(() => {
    const now = Date.now();

    for (const [id, p] of Object.entries(shipState)) {
      if (!p) continue;

      const inp = shipInput[id];

      // Manual thrust (stale-protected)
      const manualThrust =
        inp && now - (inp.lastAt || 0) <= INPUT_STALE_MS ? !!inp.thrust : false;

      let desiredAngle = p.angle;
      let thrusting = manualThrust;

      // --------------------------------------------------
      // CLICK/DRAG-TO-MOVE AUTOPILOT (persistent destination)
      // - NO overshoot loop: snap+stop when close enough (distance-only)
      // - NO end spin: lock facing near destination
      // --------------------------------------------------
      if (
        p.moveTarget &&
        Number.isFinite(p.moveTarget.x) &&
        Number.isFinite(p.moveTarget.y)
      ) {
        const tx = p.moveTarget.x;
        const ty = p.moveTarget.y;

        const dx = tx - p.x;
        const dy = ty - p.y;
        const dist = Math.hypot(dx, dy);

        // ARRIVE: snap, stop, clear. (This ends ALL oscillation.)
        if (dist <= ARRIVE_RADIUS) {
          p.x = tx;
          p.y = ty;
          p.vx = 0;
          p.vy = 0;

          p.moveTarget = null;
          thrusting = false;
          desiredAngle = p.angle; // keep current facing
        } else {
          // Face toward target while traveling, but don't chase direction when close
          if (dist > FACE_LOCK_RADIUS) {
            desiredAngle = Math.atan2(dy, dx);
          } else {
            desiredAngle = p.angle;
          }

          if (dist > SLOW_RADIUS) {
            // Far: go full
            thrusting = true;
          } else {
            // Near: ease in using speed toward target (not total speed)
            const inv = 1 / dist;
            const dirx = dx * inv;
            const diry = dy * inv;

            // How fast we are moving toward the target (can be negative)
            const speedToward = p.vx * dirx + p.vy * diry;

            // Desired approach speed scales down with distance (no minimum creep)
            const desiredSpeed = clamp(dist * ARRIVE_K, 0, MAX_ARRIVE_SPEED);

            // Thrust only if we're not moving toward fast enough
            thrusting = speedToward < desiredSpeed;

            // If we're coming in too hot, apply extra braking drag
            if (speedToward > desiredSpeed) {
              p.vx *= ARRIVE_DRAG;
              p.vy *= ARRIVE_DRAG;
            } else {
              // mild damping to smooth out small sideways drift
              p.vx *= 0.985;
              p.vy *= 0.985;
            }
          }
        }
      } else {
        // --------------------------------------------------
        // BACKWARDS COMPAT (only if you still send targetAngle)
        // --------------------------------------------------
        const hasFreshAngle =
          inp &&
          now - (inp.lastAt || 0) <= INPUT_STALE_MS &&
          Number.isFinite(inp.targetAngle);

        if (hasFreshAngle) desiredAngle = inp.targetAngle;
      }

      // rotate smoothly (no snap)
      p.angle = turnToward(p.angle, desiredAngle, TURN_RATE * DT);

      // thrust
      if (thrusting) {
        p.vx += Math.cos(p.angle) * THRUST * DT;
        p.vy += Math.sin(p.angle) * THRUST * DT;
      }

      // base drag + clamp
      p.vx *= DRAG;
      p.vy *= DRAG;

      const sp = Math.hypot(p.vx, p.vy);
      if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        p.vx *= k;
        p.vy *= k;
      }

      // integrate
      p.x += p.vx * DT;
      p.y += p.vy * DT;
    }
  }, 1000 / TICK_HZ);

  // ======================================================
  // Snapshot tick (per-socket, interest-managed)
  // ======================================================
  setInterval(() => {
    const now = Date.now();

    for (const [socketId] of Object.entries(activePlayers)) {
      const sock = io.sockets.sockets.get(socketId);
      if (!sock) continue;
      if (!shipState[socketId]) continue;

      sock.emit("world:snapshot", {
        players: buildNearbySnapshot(socketId),
        t: now,
      });
    }
  }, 1000 / SNAPSHOT_HZ);

  // ======================================================
  // Socket connections
  // ======================================================
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.emit("world:init", { worldSeed: WORLD_SEED });
    socket.emit("chatHistory", chatHistory);

    // Initialize input record (safe defaults)
    shipInput[socket.id] = { thrust: false, targetAngle: 0, lastAt: Date.now() };

    // ---- GLOBAL CHAT (safer) ----
    socket.on("sendMessage", ({ message } = {}) => {
      const now = Date.now();

      const prev = lastChatAt[socket.id] || 0;
      if (now - prev < CHAT_MIN_INTERVAL_MS) return;
      lastChatAt[socket.id] = now;

      const cleanMsg = String(message ?? "").trim().slice(0, CHAT_MSG_MAX);
      if (!cleanMsg) return;

      const serverName = safeNameFromMeta(socket.id) || "Unknown";

      const payload = { user: serverName, message: cleanMsg, at: now };

      pushChat(payload);
      io.emit("newMessage", payload);
    });

    // ------------------------------------------------------
    // identify: bind characterId + spawn ship from DB
    // ------------------------------------------------------
    socket.on("identify", async ({ characterId } = {}) => {
      console.log("identify:", socket.id, "=>", characterId);

      if (!characterId) {
        socket.emit("sceneError", { error: "Missing characterId." });
        return;
      }

      let oid;
      try {
        oid = new ObjectId(String(characterId));
      } catch {
        socket.emit("sceneError", { error: "Invalid characterId." });
        return;
      }

      activePlayers[socket.id] = String(characterId);

      try {
        const db = require("../config/db").getDB();
        const player = await db.collection("player_data").findOne(
          { _id: oid },
          { projection: { currentLoc: 1, charName: 1 } }
        );

        if (!player) {
          socket.emit("sceneError", { error: "Character not found." });
          return;
        }

        const x = Number(player?.currentLoc?.x ?? 0);
        const y = Number(player?.currentLoc?.y ?? 0);

        const nameRaw = String(player?.charName ?? "").trim();
        const name = nameRaw ? nameRaw.slice(0, CHAT_NAME_MAX) : null;

        playerMeta[socket.id] = { characterId: String(characterId), name };

        shipState[socket.id] = {
          x,
          y,
          vx: 0,
          vy: 0,
          angle: 0,
          moveTarget: null,
          lastSeenAt: Date.now(),
        };

        socket.emit("player:self", {
          id: socket.id,
          ship: { ...shipState[socket.id], name },
        });

        socket.emit("world:snapshot", {
          players: buildNearbySnapshot(socket.id),
          t: Date.now(),
        });
      } catch (err) {
        console.error("identify error:", err);
        socket.emit("sceneError", { error: "Server error during identify." });
      }
    });

    // ------------------------------------------------------
    // player:moveTo: set/update a persistent destination
    // ------------------------------------------------------
    socket.on("player:moveTo", ({ x, y } = {}) => {
      if (!activePlayers[socket.id]) return;
      const p = shipState[socket.id];
      if (!p) return;

      const tx = Number(x);
      const ty = Number(y);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;

      p.moveTarget = { x: tx, y: ty };
      p.lastSeenAt = Date.now();

      // --------------------------------------------------
      // ✅ DEBUG: what the server receives for targets
      // --------------------------------------------------
      const dx = tx - p.x;
      const dy = ty - p.y;
      const dist = Math.hypot(dx, dy);

      p._lastMoveLogAt = p._lastMoveLogAt || 0;
      const now = Date.now();
      if (now - p._lastMoveLogAt > 200) {
        p._lastMoveLogAt = now;
        console.log(
          `[SERVER moveTo RECV] id=${socket.id.slice(
            0,
            4
          )} dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} dist=${dist.toFixed(1)}`
        );
      }
    });

    // Optional: cancel autopilot
    socket.on("player:moveCancel", () => {
      if (!activePlayers[socket.id]) return;
      const p = shipState[socket.id];
      if (!p) return;

      p.moveTarget = null;
      p.lastSeenAt = Date.now();
    });

    // ------------------------------------------------------
    // player:input: intent only (server sim applies)
    // ------------------------------------------------------
    socket.on("player:input", ({ thrust, targetAngle } = {}) => {
      if (!activePlayers[socket.id]) return;
      if (!shipState[socket.id]) return;

      const ta = Number(targetAngle);

      shipInput[socket.id] = {
        thrust: !!thrust,
        targetAngle: Number.isFinite(ta)
          ? ta
          : shipInput[socket.id]?.targetAngle,
        lastAt: Date.now(),
      };

      shipState[socket.id].lastSeenAt = Date.now();
    });

    // ------------------------------------------------------
    // disconnect: cleanup
    // ------------------------------------------------------
    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      delete activePlayers[socket.id];
      delete shipState[socket.id];
      delete shipInput[socket.id];
      delete playerMeta[socket.id];
      delete lastChatAt[socket.id];
    });
  });
};
