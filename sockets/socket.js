// socketHandler.js (OPEN WORLD MMO + GLOBAL CHAT) — SAFER VERSION
const { ObjectId } = require("mongodb");
const { WORLD_SEED } = require("../world/worldSeed");

const activePlayers = {}; // socket.id -> characterId
const playerMeta = {};    // socket.id -> { characterId, name }

// Authoritative ship state
// socket.id -> { x, y, vx, vy, angle, lastSeenAt }
const shipState = {};

// Last input per player
// socket.id -> { thrust, targetAngle, lastAt }
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
const CHAT_MIN_INTERVAL_MS = 800;     // at most ~1.25 msg/sec per socket
const CHAT_MSG_MAX = 240;
const CHAT_NAME_MAX = 24;
const lastChatAt = {}; // socket.id -> timestamp

module.exports = function socketHandler(io) {
  // ======================================================
  // Tunables
  // ======================================================
  const TICK_HZ = 20; // physics tick
  const DT = 1 / TICK_HZ;

  const SNAPSHOT_HZ = 10; // network snapshot rate (MMO-ish)
  // const SNAPSHOT_DT = 1 / SNAPSHOT_HZ; // (not used)

  // Movement
  const TURN_RATE = 7.5; // rad/sec
  const THRUST = 180;    // px/sec^2
  const DRAG = 0.92;     // per-tick damping
  const MAX_SPEED = 320; // px/sec cap

  // MMO interest management
  const VIEW_RADIUS = 2400; // world units / px
  const VIEW_RADIUS_SQ = VIEW_RADIUS * VIEW_RADIUS;

  // Drop stale inputs (optional safety)
  const INPUT_STALE_MS = 2000;

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

      // Always include yourself
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

      // If input is stale, treat as no thrust (prevents "stuck thrust" on packet loss)
      const thrusting =
        inp && now - (inp.lastAt || 0) <= INPUT_STALE_MS ? !!inp.thrust : false;

      const targetAngle =
        inp && Number.isFinite(inp.targetAngle) ? inp.targetAngle : p.angle;

      // rotate
      p.angle = turnToward(p.angle, targetAngle, TURN_RATE * DT);

      // thrust
      if (thrusting) {
        p.vx += Math.cos(p.angle) * THRUST * DT;
        p.vy += Math.sin(p.angle) * THRUST * DT;
      }

      // drag + clamp
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
    console.log("🔥 Client connected:", socket.id);

    socket.emit("world:init", { worldSeed: WORLD_SEED });
    socket.emit("chatHistory", chatHistory);

    // Initialize input record (safe defaults)
    shipInput[socket.id] = { thrust: false, targetAngle: 0, lastAt: Date.now() };

    // ---- GLOBAL CHAT (safer) ----
    // - ignores client-provided "user"
    // - rate-limits per socket
    // - uses server-known charName (playerMeta)
    socket.on("sendMessage", ({ message } = {}) => {
      const now = Date.now();

      // basic per-socket rate limit
      const prev = lastChatAt[socket.id] || 0;
      if (now - prev < CHAT_MIN_INTERVAL_MS) return;
      lastChatAt[socket.id] = now;

      const cleanMsg = String(message ?? "").trim().slice(0, CHAT_MSG_MAX);
      if (!cleanMsg) return;

      const serverName = safeNameFromMeta(socket.id) || "Unknown";

      const payload = {
        user: serverName,
        message: cleanMsg,
        at: now,
      };

      pushChat(payload);
      io.emit("newMessage", payload);
    });

    // ------------------------------------------------------
    // identify: bind characterId + spawn ship from DB
    // ------------------------------------------------------
    socket.on("identify", async ({ characterId } = {}) => {
      console.log("👤 identify:", socket.id, "=>", characterId);

      if (!characterId) {
        socket.emit("sceneError", { error: "Missing characterId." });
        return;
      }

      // Validate ObjectId early
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

        // ✅ Name from DB (charName) + normalize/limit
        const nameRaw = String(player?.charName ?? "").trim();
        const name = nameRaw ? nameRaw.slice(0, CHAT_NAME_MAX) : null;

        // ✅ store meta for snapshots + chat
        playerMeta[socket.id] = { characterId: String(characterId), name };

        shipState[socket.id] = {
          x,
          y,
          vx: 0,
          vy: 0,
          angle: 0,
          lastSeenAt: Date.now(),
        };

        // ✅ include name so client can show it immediately if desired
        socket.emit("player:self", {
          id: socket.id,
          ship: { ...shipState[socket.id], name },
        });

        socket.emit("world:snapshot", {
          players: buildNearbySnapshot(socket.id),
          t: Date.now(),
        });
      } catch (err) {
        console.error("❌ identify error:", err);
        socket.emit("sceneError", { error: "Server error during identify." });
      }
    });

    // ------------------------------------------------------
    // player:input: intent only (server sim applies)
    // ------------------------------------------------------
    socket.on("player:input", ({ thrust, targetAngle } = {}) => {
      if (!activePlayers[socket.id]) return;
      if (!shipState[socket.id]) return;

      // sanitize targetAngle
      const ta = Number(targetAngle);
      shipInput[socket.id] = {
        thrust: !!thrust,
        targetAngle: Number.isFinite(ta) ? ta : shipState[socket.id].angle,
        lastAt: Date.now(),
      };

      shipState[socket.id].lastSeenAt = Date.now();
    });

    // ------------------------------------------------------
    // disconnect: cleanup
    // ------------------------------------------------------
    socket.on("disconnect", () => {
      console.log("❌ Client disconnected:", socket.id);
      delete activePlayers[socket.id];
      delete shipState[socket.id];
      delete shipInput[socket.id];
      delete playerMeta[socket.id];
      delete lastChatAt[socket.id];
    });
  });
};
