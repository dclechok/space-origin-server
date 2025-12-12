// world/sceneState.js

// Global in-memory persistent world state
const worldState = {
  scenes: {} // sceneId -> sceneState object
};

/**
 * Ensure a sceneState exists for this scene.
 * Optionally attach/refresh its config from the DB.
 */
function ensureSceneState(sceneId, sceneConfig = null) {
  const key = String(sceneId);

  if (!worldState.scenes[key]) {
    worldState.scenes[key] = {
      sceneId: key,
      config: sceneConfig || null,
      activeCreatures: [],       // ← PERSISTENT until server reboot
      playersInScene: new Set(),
      lastActive: Date.now()
    };
  } else if (sceneConfig) {
    worldState.scenes[key].config = sceneConfig;
  }

  return worldState.scenes[key];
}

/**
 * Get an existing sceneState or null
 */
function getSceneState(sceneId) {
  return worldState.scenes[String(sceneId)] || null;
}

function markSceneActive(sceneId) {
  const state = ensureSceneState(sceneId);
  state.lastActive = Date.now();
}

function addPlayerToScene(sceneId, playerId) {
  const key = String(sceneId);
  const state = ensureSceneState(key);
  state.playersInScene.add(playerId);
  state.lastActive = Date.now();
}

function removePlayerFromScene(sceneId, playerId) {
  const key = String(sceneId);
  const state = worldState.scenes[key];
  if (!state) return;
  state.playersInScene.delete(playerId);
}

/**
 * DISABLED — scenes never unload in persistent world modees
 */
function unloadScene(sceneId) {
  console.log(`⚠️ unloadScene(${sceneId}) ignored (persistent world mode).`);
}

/**
 * DISABLED — do not remove scenes automatically
 */
function cleanupInactiveScenes(timeoutMs) {
  for (const [sceneId] of Object.entries(worldState.scenes)) {
    // Just log; do nothing
    // console.log(`Scene ${sceneId} inactive but preserved.`);
  }
}

function getActiveScenes() {
  return Object.values(worldState.scenes);
}

module.exports = {
  worldState,
  ensureSceneState,
  getSceneState,
  markSceneActive,
  addPlayerToScene,
  removePlayerFromScene,
  unloadScene,
  getActiveScenes,
  cleanupInactiveScenes
};
