// socketHandler.js (SPACE / REALTIME VERSION)
const { ObjectId } = require("mongodb");
const { WORLD_SEED } = require("../world/worldSeed");

const activePlayers = {}; // socket.id -> characterId

// realtime ship state (authoritative)
// socket.id -> { x, y, vx, vy, angle, sceneId }
const shipState = {};

// last input per player
// socket.id -> { thrust, targetAngle, lastAt }
const shipInput = {};

module.exports = function socketHandler(io) {
  // -----------------------------
  // Authoritative tick loop
  // -----------------------------
  const TICK_HZ = 20;
  const DT = 1 / TICK_HZ;

  // Tunables (tweak freely)
  const TURN_RATE = 7.5;  // rad/sec
  const THRUST = 180;     // accel
  const DRAG = 0.92;      // velocity damping per tick
  const MAX_SPEED = 320;  // cap

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

  setInterval(() => {
    // update physics
    for (const id of Object.keys(shipState)) {
      const p = shipState[id];
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

    // broadcast snapshots PER SCENE ROOM
    const byScene = new Map(); // sceneId -> players map

    for (const [id, p] of Object.entries(shipState)) {
      if (!p.sceneId) continue;
      if (!byScene.has(p.sceneId)) byScene.set(p.sceneId, {});
      byScene.get(p.sceneId)[id] = { x: p.x, y: p.y, angle: p.angle };
    }

    for (const [sceneId, players] of byScene.entries()) {
      io.to(sceneId).emit("world:snapshot", {
        players,
        t: Date.now(),
      });
    }
  }, 1000 / TICK_HZ);

  // -----------------------------
  // Socket connections
  // -----------------------------
  io.on("connection", (socket) => {
    console.log("🔥 Client connected:", socket.id);

    // World seed (shared background determinism)
    socket.emit("world:init", { worldSeed: WORLD_SEED });

    // Identify player (attach characterId + init ship state from DB)
    socket.on("identify", async ({ characterId }) => {
      console.log("👤 identify:", socket.id, "=>", characterId);
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

        // tell the client its authoritative id + initial state
        socket.emit("player:self", { id: socket.id, ship: shipState[socket.id] });
      } catch (err) {
        console.error("❌ identify error:", err);
        socket.emit("sceneError", { error: "Server error during identify." });
      }
    });

    // Load scene (joins scene room so you only see local players)
    socket.on("loadScene", async ({ x, y } = {}) => {
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
          return socket.emit("sceneError", { error: `Scene [${px}, ${py}] not found` });
        }

        const sceneId = String(scene._id);

        // leave any previous scene rooms (optional safety)
        // note: socket.rooms includes socket.id by default; leave only actual rooms
        for (const room of socket.rooms) {
          if (room !== socket.id) socket.leave(room);
        }

        socket.join(sceneId);

        // make sure ship state exists
        if (!shipState[socket.id]) {
          shipState[socket.id] = { x: px, y: py, vx: 0, vy: 0, angle: 0, sceneId };
        } else {
          shipState[socket.id].sceneId = sceneId;
          // (optional) snap to DB position when loading
          shipState[socket.id].x = px;
          shipState[socket.id].y = py;
        }

        // minimal scene data for your UI (keep or expand later)
        socket.emit("sceneData", {
          currentLoc: { x: px, y: py },
          name: scene.name,
          entranceDesc: scene.entranceDesc,
          exits: scene.exits,
          region: scene.regionId,
          security: scene.security ?? 0,
        });

        // push an immediate snapshot so the client renders instantly
        io.to(sceneId).emit("world:snapshot", {
          players: Object.fromEntries(
            Object.entries(shipState)
              .filter(([, p]) => p.sceneId === sceneId)
              .map(([id, p]) => [id, { x: p.x, y: p.y, angle: p.angle }])
          ),
          t: Date.now(),
        });
      } catch (err) {
        console.error("❌ loadScene error:", err);
        socket.emit("sceneError", { error: "Server error loading scene" });
      }
    });

    // Receive input intent (authoritative server sim)
    socket.on("player:input", ({ thrust, targetAngle }) => {
      if (!activePlayers[socket.id]) return; // must identify first
      if (!shipState[socket.id]) return;      // must have ship state

      shipInput[socket.id] = {
        thrust: !!thrust,
        targetAngle: Number.isFinite(targetAngle) ? targetAngle : 0,
        lastAt: Date.now(),
      };
    });

    socket.on("disconnect", () => {
      console.log("❌ Client disconnected:", socket.id);
      delete activePlayers[socket.id];
      delete shipState[socket.id];
      delete shipInput[socket.id];
    });
  });
};
