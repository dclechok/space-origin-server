// world/spawner.js

const { getCreatureTemplate } = require("../mobs/creatureRegistry");

let ioRef = null;

// Utility: random float within scene bounds
function randomInt(max) {
  return Math.floor(Math.random() * max);
}

/**
 * WORLD TICK
 */
function updateSceneSpawns(sceneState, now = Date.now()) {
  const sceneConfig = sceneState.config;
  if (!sceneConfig || !Array.isArray(sceneConfig.spawners)) return;

  console.log("🔍 Checking spawners for scene:", sceneState.sceneId);

  for (const spawner of sceneConfig.spawners) {
    ensureSpawnerPopulation(sceneState, spawner, now);
  }

  handleRespawns(sceneState, now);
}

/**
 * Ensure spawner has correct number of creatures
 */
function ensureSpawnerPopulation(sceneState, spawner, now) {
  const { creatureId, maxAlive = 0 } = spawner;

  const aliveList = sceneState.activeCreatures.filter(
    c => c.alive && c.creatureId === creatureId && c.spawnerId === spawner.id
  );

  const missing = maxAlive - aliveList.length;
  if (missing <= 0) return;

  console.log(`🐀 Spawner '${spawner.id}' missing ${missing} creatures.`);

  for (let i = 0; i < missing; i++) {
    spawnCreature(sceneState, spawner, now);
  }
}

/**
 * Spawn creature WITH SERVER-ASSIGNED RANDOM POSITION + RANDOM FACING
 */
let instanceCounter = 1;
function spawnCreature(sceneState, spawner, now) {
  const template = getCreatureTemplate(spawner.creatureId);
  if (!template) {
    console.error("❌ Creature template not found:", spawner.creatureId);
    return;
  }

  // Scene dimensions (fallbacks)
  const sceneWidth = sceneState.config?.width ?? 800;
  const sceneHeight = sceneState.config?.height ?? 450;

  // RANDOM POSITION — server authoritative
  const randomXPos =
    spawner.spawnX ??
    randomInt(sceneWidth - 64); // sprite width approx

  const randomYPos =
    spawner.spawnY ??
    randomInt(sceneHeight - 64);

  // RANDOM FACING (kept for all players)
  const facing = Math.random() < 0.5 ? 1 : -1;

  const instance = {
    ...template,
    instanceId: `${template.id}#${instanceCounter++}`,
    creatureId: template.id,
    spawnerId: spawner.id,
    alive: true,
    respawnAt: null,

    // SERVER-PROVIDED RANDOM COORDINATES
    x: randomXPos,
    y: randomYPos,

    // FACE LEFT (-1) OR RIGHT (1)
    facing
  };

  if (template.stats?.maxHP) {
    instance.currentHP = template.stats.maxHP;
  }

  sceneState.activeCreatures.push(instance);

  console.log(`🧬 Spawned ${instance.instanceId} at (${instance.x}, ${instance.y}) facing ${instance.facing}`);

  // → broadcast entrance message
  if (instance.entranceDesc && ioRef) {
    for (const pid of sceneState.playersInScene) {
      ioRef.to(pid).emit("terminal_message", instance.entranceDesc);
    }
  }

  // → broadcast spawn event WITH THE NEW POSITION + FACING
  if (ioRef) {
    for (const pid of sceneState.playersInScene) {
      ioRef.to(pid).emit("creature_spawned", instance);
    }
  }

  return instance;
}

/**
 * Death + Respawn
 */
function markCreatureDead(creature, spawnerConfig, now = Date.now()) {
  creature.alive = false;
  creature.respawnAt = now + (spawnerConfig.respawnSec || 30) * 1000;
}

function handleRespawns(sceneState, now) {
  for (const creature of sceneState.activeCreatures) {
    if (!creature.alive || !creature.respawnAt || now < creature.respawnAt) continue;

    // fully respawned
    creature.alive = true;
    creature.respawnAt = null;

    // restore HP
    if (creature.stats?.maxHP) {
      creature.currentHP = creature.stats.maxHP;
    }

    // assign NEW random location and facing
    creature.x = randomInt(800 - 64); // you can use scene width
    creature.y = randomInt(450 - 64);
    creature.facing = Math.random() < 0.5 ? 1 : -1;

    console.log(`🔄 Respawned ${creature.instanceId} @ (${creature.x}, ${creature.y})`);

    if (ioRef) {
      for (const pid of sceneState.playersInScene) {
        ioRef.to(pid).emit("creature_respawned", creature);
      }
    }
  }
}

function initSpawner(io) {
  ioRef = io;
  console.log("🔌 Spawner IO initialized.");
}

module.exports = {
  initSpawner,
  updateSceneSpawns,
  spawnCreature,
  markCreatureDead
};
