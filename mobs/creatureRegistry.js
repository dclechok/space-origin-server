// mobs/creatureRegistry.js
//
// Automatically loads every creature file in this folder.
// Registers creatures by their .id field so the spawner can
// create them from just the string ID (e.g., "slag_rat").
//

const fs = require("fs");
const path = require("path");

const creaturesDir = __dirname;
const registry = {}; // creatureId -> factory function

// Read every file in /mobs
fs.readdirSync(creaturesDir).forEach(file => {
  if (!file.endsWith(".js")) return;
  if (file === "creatureRegistry.js") return; // Skip this file

  const filePath = path.join(creaturesDir, file);
  const mod = require(filePath);

  // A creature file usually exports ONE factory, but we check all exports.
  for (const exportKey of Object.keys(mod)) {
    const factory = mod[exportKey];

    if (typeof factory !== "function") continue;

    // Create temp instance to inspect .id
    let temp;
    try {
      temp = factory();
    } catch (err) {
      console.warn(`[CreatureRegistry] Could not instantiate ${exportKey} from ${file}:`, err);
      continue;
    }

    if (!temp || !temp.id) {
      console.warn(`[CreatureRegistry] WARNING: '${exportKey}' in ${file} has no .id field.`);
      continue;
    }

    const creatureId = temp.id;

    registry[creatureId] = factory;

    console.log(`[CreatureRegistry] Registered '${creatureId}' from ${file}`);
  }
});

/**
 * Returns a **fresh template** for the given creatureId.
 * Used by spawner.js
 */
function getCreatureTemplate(creatureId) {
  const factory = registry[creatureId];
  if (!factory) {
    throw new Error(`[CreatureRegistry] Creature '${creatureId}' not found.`);
  }
  return factory(); // return a fresh creature object
}

module.exports = {
  registry,
  getCreatureTemplate
};
