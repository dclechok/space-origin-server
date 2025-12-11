// world/spawner.js

const { getCreatureTemplate } = require("../mobs/creatureRegistry");

let ioRef = null; // <-- FIXED: define ioRef safely

/**
 * Called by worldTick.js once per tick for every loaded scene.
 * Ensures each spawner has the correct number of creatures alive.
 */
function updateSceneSpawns(sceneState, now = Date.now()) {
  const sceneConfig = sceneState.config;

  if (!sceneConfig || !Array.isArray(sceneConfig.spawners)) {
    return; // scene has no spawners
  }

  // Debug:
  console.log("🔍 Checking spawners for scene:", sceneState.sceneId);

  for (const spawner of sceneConfig.spawners) {
    ensureSpawnerPopulation(sceneState, spawner, now);
  }

  handleRespawns(sceneState, now);
}

/**
 * Ensures each spawner has the required number of alive creatures.
 */
function ensureSpawnerPopulation(sceneState, spawner, now) {
  const { creatureId, maxAlive = 0 } = spawner;

  const aliveList = sceneState.activeCreatures.filter(
    (c) => c.alive && c.creatureId === creatureId && c.spawnerId === spawner.id
  );

  const missing = maxAlive - aliveList.length;

  if (missing <= 0) return;

  console.log(`🐀 Spawner '${spawner.id}' missing ${missing} creatures.`);

  for (let i = 0; i < missing; i++) {
    spawnCreature(sceneState, spawner, now);
  }
}

/**
 * Spawn a new creature and notify the players.
 */
let instanceCounter = 1;
function spawnCreature(sceneState, spawner, now) {
  const template = getCreatureTemplate(spawner.creatureId);

  if (!template) {
    console.error("❌ ERROR: Creature template not found:", spawner.creatureId);
    return;
  }

  const instance = {
    ...template,
    instanceId: `${template.id}#${instanceCounter++}`,
    creatureId: template.id,
    spawnerId: spawner.id,
    alive: true,
    respawnAt: null,
    x: spawner.spawnX || 0,
    y: spawner.spawnY || 0
  };

  // HP initialization
  if (template.stats?.maxHP) {
    instance.currentHP = template.stats.maxHP;
  }

  // Add to scene
  sceneState.activeCreatures.push(instance);

  console.log(`🧬 Spawned creature: ${instance.instanceId} (${instance.name})`);

  // Broadcast entranceDesc to all players in this scene
  if (instance.entranceDesc && ioRef) {
    sceneState.playersInScene.forEach((playerId) => {
      ioRef.to(playerId).emit("terminal_message", instance.entranceDesc);
    });
  }

  // Also broadcast creature_spawned event
  if (ioRef) {
    sceneState.playersInScene.forEach((playerId) => {
      ioRef.to(playerId).emit("creature_spawned", instance);
    });
  }

  return instance;
}

/**
 * Marks a creature dead and schedules respawn.
 */
function markCreatureDead(creature, spawnerConfig, now = Date.now()) {
  creature.alive = false;
  const respawnDelay = (spawnerConfig.respawnSec || 30) * 1000;
  creature.respawnAt = now + respawnDelay;
}

/**
 * Respawn any dead creatures whose respawn timers expired.
 */
function handleRespawns(sceneState, now) {
  for (const creature of sceneState.activeCreatures) {
    if (!creature.alive && creature.respawnAt && now >= creature.respawnAt) {
      creature.alive = true;
      creature.respawnAt = null;

      if (creature.stats?.maxHP) {
        creature.currentHP = creature.stats.maxHP;
      }

      console.log(`🔄 Respawned: ${creature.instanceId}`);

      if (ioRef) {
        sceneState.playersInScene.forEach((playerId) => {
          ioRef.to(playerId).emit("creature_respawned", creature);
        });
      }
    }
  }
}

function initSpawner(io) {
  ioRef = io; // <-- FIXED: correctly store io instance
  console.log("🔌 Spawner IO initialized.");
}

module.exports = {
  initSpawner,
  updateSceneSpawns,
  spawnCreature,
  markCreatureDead
};
