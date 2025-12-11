// world/sceneState.js

// Global in-memory world state
const worldState = {
  scenes: {} // sceneId -> sceneState object
};

/**
 * Ensure a sceneState exists for this scene.
 * Optionally attach/refresh its config from the DB.
 */
function ensureSceneState(sceneId, sceneConfig = null) {
  const key = String(sceneId);   // ← FIX HERE

  if (!worldState.scenes[key]) {
    worldState.scenes[key] = {
      sceneId: key,
      config: sceneConfig || null,
      activeCreatures: [],
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

/**
 * Mark scene as active (called whenever a player interacts with it)
 */
function markSceneActive(sceneId) {
  const state = ensureSceneState(sceneId);
  state.lastActive = Date.now();
}

/**
 * Track players entering / leaving scenes (optional but useful)
 */
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
 * Unload a scene from memory (e.g., no players for a while)
 */
function unloadScene(sceneId) {
  delete worldState.scenes[sceneId];
}

/**
 * Return all active scene states as an array
 */
function getActiveScenes() {
  return Object.values(worldState.scenes);
}

/**
 * Optional cleanup: remove scenes with no players after timeoutMs
 */
function cleanupInactiveScenes(timeoutMs = 10 * 60 * 1000) {
  const now = Date.now();
  for (const [sceneId, state] of Object.entries(worldState.scenes)) {
    if (state.playersInScene.size === 0 &&
        now - state.lastActive > timeoutMs) {
      delete worldState.scenes[sceneId];
    }
  }
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
