// world/worldTick.js

const { 
  getActiveScenes, 
  cleanupInactiveScenes 
} = require("./sceneState");

const { updateSceneSpawns } = require("./spawner");

// When you have AI, you'll import it:
// const { runSceneAI } = require("./creatureAI");

const TICK_RATE_MS = 1000; // 1 second (change to 500 for faster tick)

/**
 * Starts the world simulation tick loop.
 * Call this ONCE from server.js after sockets + DB are ready.
 */
function startWorldTick() {
  console.log("🌍 World Tick Started");

  setInterval(() => {
    const now = Date.now();

    // Get list of all active sceneStates in memory
    const activeScenes = getActiveScenes();

    for (const sceneState of activeScenes) {
      // 1️⃣ Handle spawning + respawns
      updateSceneSpawns(sceneState, now);

      // 2️⃣ Handle creature AI (when implemented)
      // runSceneAI(sceneState, now);

      // You can also add weather, timers, etc here later
    }

    // 3️⃣ Clean up scenes with no players
    cleanupInactiveScenes();

  }, TICK_RATE_MS);
}

module.exports = { startWorldTick };
