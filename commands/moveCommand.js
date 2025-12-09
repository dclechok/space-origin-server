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
    if (!dir) return { error: "Invalid direction." };

    const db = require("../config/db").getDB();

    const oldX = player.currentLoc.x;
    const oldY = player.currentLoc.y;

    const newX = oldX + dir.dx;
    const newY = oldY + dir.dy;

    const scene = await db.collection("scene_data").findOne({ x: newX, y: newY });

    if (!scene) return { error: "You can't go that way." };

    await db.collection("player_data").updateOne(
        { _id: player._id },
        { $set: { "currentLoc.x": newX, "currentLoc.y": newY } }
    );

    return {
        message: `You move ${cmd}.`,
        x: newX,
        y: newY,
        entranceDesc: scene.entranceDesc,
        exits: scene.exits,
        region: scene.region
    };
};
