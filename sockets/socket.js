// socketHandler.js (SPACE / REALTIME VERSION) — CLEAN + GLOBAL CHAT
const { ObjectId } = require("mongodb");
const { WORLD_SEED } = require("../world/worldSeed");

const activePlayers = {}; // socket.id -> characterId

// Authoritative ship state
// socket.id -> { x, y, vx, vy, angle, sceneId }
const shipState = {};

// Last input per player
// socket.id -> { thrust, targetAngle, lastAt }
const shipInput = {};

// ------------------------------
// GLOBAL CHAT (server-wide)
// ------------------------------
const CHAT_MAX = 100;
const chatHistory = []; // [{ user, message, at }]

function pushChat(msg) {
  chatHistory.push(msg);
  if (chatHistory.length > CHAT_MAX) {
    chatHistory.splice(0, chatHistory.length - CHAT_MAX);
  }
}

module.exports = function socketHandler(io) {
  // ======================================================
  // Authoritative tick loop
  // ======================================================
  const TICK_HZ = 20;
  const DT = 1 / TICK_HZ;

  // Tunables (tweak freely)
  const TURN_RATE = 7.5; // rad/sec
  const THRUST = 180; // px/sec^2
  const DRAG = 0.92; // per-tick damping
  const MAX_SPEED = 320; // px/sec cap

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

  function buildSnapshotForScene(sceneId) {
    const players = {};
    for (const [id, p] of Object.entries(shipState)) {
      if (!p || p.sceneId !== sceneId) continue;
      players[id] = { x: p.x, y: p.y, angle: p.angle };
    }
    return players;
  }

  setInterval(() => {
    // 1) Simulate movement
    for (const [id, p] of Object.entries(shipState)) {
      if (!p) continue;

      const inp = shipInput[id];

      if (inp) {
        p.angle = turnToward(p.angle, inp.targetAngle, TURN_RATE * DT);

        if (inp.thrust) {
          p.vx += Math.cos(p.angle) * THRUST * DT;
          p.vy += Math.sin(p.angle) * THRUST * DT;
        }
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

    // 2) Broadcast per-scene snapshots
    const scenes = new Set();
    for (const p of Object.values(shipState)) {
      if (p?.sceneId) scenes.add(p.sceneId);
    }

    const now = Date.now();
    for (const sceneId of scenes) {
      io.to(sceneId).emit("world:snapshot", {
        players: buildSnapshotForScene(sceneId),
        t: now,
      });
    }
  }, 1000 / TICK_HZ);

  // ======================================================
  // Socket connections
  // ======================================================
  io.on("connection", (socket) => {
    console.log("🔥 Client connected:", socket.id);

    // Seed (for deterministic background)
    socket.emit("world:init", { worldSeed: WORLD_SEED });

    // Initialize input record immediately (prevents undefined edge cases)
    shipInput[socket.id] = { thrust: false, targetAngle: 0, lastAt: Date.now() };

    // ---- GLOBAL CHAT: send history immediately on connect ----
    socket.emit("chatHistory", chatHistory);

    // ---- GLOBAL CHAT: receive + broadcast ----
    socket.on("sendMessage", ({ user, message } = {}) => {
      const cleanUser = String(user ?? "").trim().slice(0, 24);
      const cleanMsg = String(message ?? "").trim().slice(0, 240);
      if (!cleanMsg) return;

      const payload = {
        user: cleanUser || "Unknown",
        message: cleanMsg,
        at: Date.now(),
      };

      pushChat(payload);
      io.emit("newMessage", payload); // server-wide
    });

    // ------------------------------------------------------
    // identify: bind characterId + spawn ship from DB
    // ------------------------------------------------------
    socket.on("identify", async ({ characterId }) => {
      console.log("👤 identify:", socket.id, "=>", characterId);

      if (!characterId) {
        socket.emit("sceneError", { error: "Missing characterId." });
        return;
      }

      activePlayers[socket.id] = characterId;

      try {
        const db = require("../config/db").getDB();
        const player = await db.collection("player_data").findOne({
          _id: new ObjectId(characterId),
        });

        const x = Number(player?.currentLoc?.x ?? 0);
        const y = Number(player?.currentLoc?.y ?? 0);

        shipState[socket.id] = {
          x,
          y,
          vx: 0,
          vy: 0,
          angle: 0,
          sceneId: null,
        };

        // tell the client its authoritative socket id + initial ship state
        socket.emit("player:self", { id: socket.id, ship: shipState[socket.id] });
      } catch (err) {
        console.error("❌ identify error:", err);
        socket.emit("sceneError", { error: "Server error during identify." });
      }
    });

    // ------------------------------------------------------
    // loadScene: join scene room (so snapshots are local)
    // ------------------------------------------------------
    socket.on("loadScene", async (_payload = {}) => {
      try {
        const db = require("../config/db").getDB();

        const characterId = activePlayers[socket.id];
        if (!characterId) {
          return socket.emit("sceneError", { error: "Player not identified." });
        }

        const player = await db.collection("player_data").findOne({
          _id: new ObjectId(characterId),
        });

        if (!player) {
          return socket.emit("sceneError", { error: "Player not found." });
        }

        const px = Number(player?.currentLoc?.x ?? 0);
        const py = Number(player?.currentLoc?.y ?? 0);

        const scene = await db.collection("scene_data").findOne({ x: px, y: py });
        if (!scene) {
          return socket.emit("sceneError", {
            error: `Scene [${px}, ${py}] not found`,
          });
        }

        const sceneId = String(scene._id);

        // Leave any previous non-default rooms
        for (const room of socket.rooms) {
          if (room !== socket.id) socket.leave(room);
        }

        socket.join(sceneId);

        // Ensure ship state exists
        if (!shipState[socket.id]) {
          shipState[socket.id] = { x: px, y: py, vx: 0, vy: 0, angle: 0, sceneId };
        } else {
          shipState[socket.id].sceneId = sceneId;
          // snap to DB position on load
          shipState[socket.id].x = px;
          shipState[socket.id].y = py;
        }

        // Minimal scene data (keep for UI)
        socket.emit("sceneData", {
          currentLoc: { x: px, y: py },
          name: scene.name,
          entranceDesc: scene.entranceDesc,
          exits: scene.exits,
          region: scene.regionId,
          security: scene.security ?? 0,
        });

        // Immediate snapshot so they render instantly
        io.to(sceneId).emit("world:snapshot", {
          players: buildSnapshotForScene(sceneId),
          t: Date.now(),
        });
      } catch (err) {
        console.error("❌ loadScene error:", err);
        socket.emit("sceneError", { error: "Server error loading scene" });
      }
    });

    // ------------------------------------------------------
    // player:input: intent only (server sim applies)
    // ------------------------------------------------------
    socket.on("player:input", ({ thrust, targetAngle } = {}) => {
      const hasActive = !!activePlayers[socket.id];
      const hasShip = !!shipState[socket.id];

      if (!hasActive || !hasShip) return;

      shipInput[socket.id] = {
        thrust: !!thrust,
        targetAngle: Number.isFinite(targetAngle) ? targetAngle : 0,
        lastAt: Date.now(),
      };
    });

    // ------------------------------------------------------
    // disconnect: cleanup
    // ------------------------------------------------------
    socket.on("disconnect", () => {
      console.log("❌ Client disconnected:", socket.id);
      delete activePlayers[socket.id];
      delete shipState[socket.id];
      delete shipInput[socket.id];
      // (chatHistory is global; keep it)
    });
  });
};
