const { getCreatureTemplate } = require("../mobs/creatureRegistry");

let ioRef = null;

// Utility random int
function randomInt(max) {
  return Math.floor(Math.random() * max);
}

/* ----------------------------------------------------------------------------
   CLASSIFICATION Y-RANGES (percentage of scene height)
---------------------------------------------------------------------------- */
const CLASS_Y_RANGES = {
  vermin:   [78, 88],
  humanoid: [75, 85],
  beast:    [80, 88],
  flyer:    [62, 70],
  boss:     [72, 82]
};

/* ----------------------------------------------------------------------------
   WORLD TICK
---------------------------------------------------------------------------- */
function updateSceneSpawns(sceneState, now = Date.now()) {
  const sceneConfig = sceneState.config;
  if (!sceneConfig || !Array.isArray(sceneConfig.spawners)) return;

  console.log("🔍 Checking spawners for scene:", sceneState.sceneId);

  for (const spawner of sceneConfig.spawners) {
    ensureSpawnerPopulation(sceneState, spawner, now);
  }

  handleRespawns(sceneState, now);
}

/* ----------------------------------------------------------------------------
   ENSURE POPULATION
---------------------------------------------------------------------------- */
function ensureSpawnerPopulation(sceneState, spawner) {
  const { creatureId, maxAlive = 0 } = spawner;

  const aliveList = sceneState.activeCreatures.filter(
    c => c.alive && c.creatureId === creatureId && c.spawnerId === spawner.id
  );

  const missing = maxAlive - aliveList.length;
  if (missing <= 0) return;

  for (let i = 0; i < missing; i++) {
    spawnCreature(sceneState, spawner);
  }
}

/* ----------------------------------------------------------------------------
   SPAWN CREATURE
---------------------------------------------------------------------------- */
let instanceCounter = 1;

function spawnCreature(sceneState, spawner) {
  const rawTemplate = getCreatureTemplate(spawner.creatureId);
  if (!rawTemplate) {
    console.error("❌ Creature template not found:", spawner.creatureId);
    return;
  }

  // clone template so mutations never touch the original
  const template = { ...rawTemplate };

  // ensure template cannot override facing
  delete template.facing;

  const sceneWidth = sceneState.config?.width ?? 800;
  const sceneHeight = sceneState.config?.height ?? 450;

  // Determine classification Y-range
  const range = CLASS_Y_RANGES[template.classification];

  function pickY() {
    if (range) {
      const [min, max] = range;
      return Math.floor(((Math.random() * (max - min)) + min) / 100 * sceneHeight);
    }
    return randomInt(sceneHeight - 64);
  }

  const x = spawner.spawnX !== undefined ? spawner.spawnX : randomInt(sceneWidth - 64);
  const y = spawner.spawnY !== undefined ? spawner.spawnY : pickY();

  // Build creature instance
  const instance = {
    ...template,
    instanceId: `${template.id}#${instanceCounter++}`,
    creatureId: template.id,
    spawnerId: spawner.id,
    alive: true,
    respawnAt: null,
    x,
    y
  };

  // Apply random facing AFTER template spread
  instance.facing = Math.random() < 0.5 ? 1 : -1;

  if (template.stats?.maxHP) {
    instance.currentHP = template.stats.maxHP;
  }

  sceneState.activeCreatures.push(instance);

  console.log("CREATURE OUTGOING:", instance);

  // Broadcast spawn event
  if (ioRef) {
    for (const pid of sceneState.playersInScene) {
      ioRef.to(pid).emit("creature_spawned", instance);
    }
  }

  return instance;
}

/* ----------------------------------------------------------------------------
   DEATH + RESPAWN
---------------------------------------------------------------------------- */
function markCreatureDead(creature, spawnerConfig, now = Date.now()) {
  creature.alive = false;
  creature.respawnAt = now + (spawnerConfig.respawnSec || 30) * 1000;
}

function handleRespawns(sceneState, now) {
  const sceneWidth = sceneState.config?.width ?? 800;
  const sceneHeight = sceneState.config?.height ?? 450;

  for (const creature of sceneState.activeCreatures) {
    if (!creature.alive || !creature.respawnAt || now < creature.respawnAt) continue;

    creature.alive = true;
    creature.respawnAt = null;

    if (creature.stats?.maxHP) {
      creature.currentHP = creature.stats.maxHP;
    }

    const range = CLASS_Y_RANGES[creature.classification];

    function pickX() {
      return randomInt(sceneWidth - 64);
    }

    function pickY() {
      if (range) {
        const [min, max] = range;
        return Math.floor(((Math.random() * (max - min)) + min) / 100 * sceneHeight);
      }
      return randomInt(sceneHeight - 64);
    }

    creature.x = pickX();
    creature.y = pickY();

    // Random facing again
    creature.facing = Math.random() < 0.5 ? 1 : -1;

    console.log("🔄 Respawned:", creature);

    if (ioRef) {
      for (const pid of sceneState.playersInScene) {
        ioRef.to(pid).emit("creature_respawned", creature);
      }
    }
  }
}

/* ----------------------------------------------------------------------------
   INIT
---------------------------------------------------------------------------- */
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
