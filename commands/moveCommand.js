const DIR = {
    n: { dx: 0, dy: 1 },
    north: { dx: 0, dy: 1 },

    s: { dx: 0, dy: -1 },
    south: { dx: 0, dy: -1 },

    e: { dx: 1, dy: 0 },
    east: { dx: 1, dy: 0 },

    w: { dx: -1, dy: 0 },
    west: { dx: -1, dy: 0 },
};

module.exports = async function moveCommand(cmd, player, socket) {
    const dir = DIR[cmd];

    if (!dir) {
        console.log("❌ Invalid direction received:", cmd);
        return { error: "Invalid direction." };
    }

    const db = require("../config/db").getDB();

    const oldX = player.currentLoc.x;
    const oldY = player.currentLoc.y;

    const newX = oldX + dir.dx;
    const newY = oldY + dir.dy;

    console.log("--------------------------------------------------");
    console.log("🛰 MOVE COMMAND RECEIVED");
    console.log("Player ID:", player._id.toString());
    console.log("Old coords:", oldX, oldY);
    console.log("Delta:", dir.dx, dir.dy);
    console.log("New coords:", newX, newY);

    // Load the new scene
    const scene = await db.collection("scene_data").findOne({
        x: newX,
        y: newY
    });

    if (!scene) {
        console.log("❌ No scene at:", newX, newY);
        return { error: "You can't go that way." };
    }

    console.log("✅ Found scene:", scene.name);

    // Update the in-memory player object
    player.currentLoc.x = newX;
    player.currentLoc.y = newY;

    console.log("🧪 Attempting DB update…");

    const update = await db.collection("player_data").updateOne(
        { _id: player._id },
        {
            $set: {
                "currentLoc.x": newX,
                "currentLoc.y": newY
            }
        }
    );

    console.log("🔍 DB Update Result:", update);

    if (update.matchedCount === 0) {
        console.error("❌ No player matched this _id — location NOT updated!");
    } else if (update.modifiedCount === 0) {
        console.warn("⚠ Player matched but location unchanged (same coords?)");
    } else {
        console.log("✅ Player location updated in DB!");
    }

    console.log("--------------------------------------------------");

    // Return proper sceneData shape
    return {
        message: `You move ${cmd}.`,
        currentLoc: { x: newX, y: newY },
        name: scene.name,
        entranceDesc: scene.entranceDesc,
        exits: scene.exits,
        region: scene.regionId,
        security: scene.security ?? 0
    };
};
