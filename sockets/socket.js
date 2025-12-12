// socketHandler.js
const commandParser = require("./../commands/commandParser");
const { ObjectId } = require("mongodb");
const activePlayers = {};
const { ensureSceneState, addPlayerToScene, getSceneState } = require("../world/sceneState");

module.exports = function socketHandler(io) {

    const regionHistory = {};

    io.on("connection", (socket) => {
        console.log("🔥 Client connected:", socket.id);

        socket.on("identify", ({ characterId }) => {
            console.log("👤 identify:", socket.id, "=>", characterId);
            activePlayers[socket.id] = characterId;
        });

        // ----------------------------------------------------
        // REGIONAL CHAT
        // ----------------------------------------------------
        socket.on("joinRegion", (region) => {
            if (!region) return;
            socket.join(region);

            const history = regionHistory[region] || [];
            socket.emit("chatHistory", history);
        });

        socket.on("sendMessage", (data) => {
            const { region, user, message } = data;
            if (!region || !message) return;

            const msg = {
                id: Date.now(),
                region,
                user,
                message,
                time: new Date().toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                }),
            };

            regionHistory[region] ||= [];
            regionHistory[region].push(msg);
            if (regionHistory[region].length > 50)
                regionHistory[region].shift();

            io.to(region).emit("newMessage", msg);
        });

        // ======================================================
        //  🔵 loadScene — SERVER IS AUTHORITATIVE
        // ======================================================
        socket.on("loadScene", async ({ x, y }) => {
            console.log("📥 loadScene request:", x, y);

            try {
                const db = require("../config/db").getDB();

                const characterId = activePlayers[socket.id];
                if (!characterId)
                    return socket.emit("sceneError", { error: "Player not identified." });

                const player = await db.collection("player_data").findOne({
                    _id: new ObjectId(characterId)
                });

                if (!player)
                    return socket.emit("sceneError", { error: "Player not found." });

                const px = Number(player.currentLoc.x);
                const py = Number(player.currentLoc.y);

                const scene = await db.collection("scene_data").findOne({
                    x: px,
                    y: py
                });

                if (!scene) {
                    return socket.emit("sceneError", {
                        error: `Scene [${px}, ${py}] not found`
                    });
                }

                ensureSceneState(scene._id, scene);
                addPlayerToScene(scene._id, socket.id);
                const sceneState = getSceneState(scene._id);

                socket.emit("sceneData", {
                    currentLoc: { x: px, y: py },
                    name: scene.name,
                    entranceDesc: scene.entranceDesc,
                    exits: scene.exits,
                    region: scene.regionId,
                    security: scene.security ?? 0,
                    creatures: sceneState.activeCreatures.filter(c => c.alive)
                });

            } catch (err) {
                console.error("❌ loadScene error:", err);
                socket.emit("sceneError", { error: "Server error loading scene" });
            }
        });

        // ======================================================
        // 🔵 COMMAND HANDLING (MOVE, TALK, ETC.)
        // ======================================================
        socket.on("command", async (input) => {
            try {
                const parsed = commandParser(input);

                if (parsed.error) {
                    return socket.emit("sceneData", { error: parsed.error });
                }

                const { handler, cmd } = parsed;
                const characterId = activePlayers[socket.id];

                if (!characterId) {
                    return socket.emit("sceneData", { error: "Player not identified." });
                }

                const db = require("../config/db").getDB();

                const player = await db.collection("player_data").findOne({
                    _id: new ObjectId(characterId)
                });

                if (!player) {
                    return socket.emit("sceneData", { error: "Player not found." });
                }

                // Handle command (move, etc.)
                const result = await handler(cmd, player, socket);

                const rx = result.currentLoc?.x ?? result.x;
                const ry = result.currentLoc?.y ?? result.y;

                const normalized = {
                    ...result,
                    x: rx,
                    y: ry,
                    currentLoc: { x: rx, y: ry }
                };

                // ======================================================
                // ⭐ ADDED BLOCK — LOAD SCENE CREATURES ON MOVE
                // ======================================================
                if (rx !== undefined && ry !== undefined) {
                    const newScene = await db.collection("scene_data").findOne({ x: rx, y: ry });

                    if (newScene) {
                        ensureSceneState(newScene._id, newScene);
                        const newSceneState = getSceneState(newScene._id);

                        normalized.creatures = newSceneState.activeCreatures.filter(c => c.alive);
                        normalized.entranceDesc = newScene.entranceDesc;
                        normalized.exits = newScene.exits;
                        normalized.region = newScene.regionId;
                        normalized.security = newScene.security ?? 0;
                        normalized.name = newScene.name;
                    }

                    // Save new location
                    await db.collection("player_data").updateOne(
                        { _id: player._id },
                        { $set: { "currentLoc.x": rx, "currentLoc.y": ry } }
                    );
                }

                socket.emit("sceneData", normalized);

            } catch (err) {
                console.error("COMMAND ERROR:", err);
                socket.emit("sceneData", { error: "Server error processing command." });
            }
        });

        socket.on("disconnect", () => {
            console.log("❌ Client disconnected:", socket.id);
            delete activePlayers[socket.id];
        });
    });
};
