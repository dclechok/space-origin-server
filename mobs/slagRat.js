function slagRat(overrides = {}) {
  return {
    id: "slagrat",
    name: "Slag Rat",
    classification: "vermin",
    level: 1,

    entranceDesc:
      "A blistered, hairless rat scurries forward from a pile of slag.",
    shortDesc: "A blistered slag rat twitches nearby.",

    stats: {
      maxHP: 10 + Math.floor(Math.random() * 4), 
      attack: 3,
      defense: 1,
      speed: 2,
      accuracy: 70
    },

    ai: {
      behavior: "aggressive",
      // wander: true,
      attackStyle: "bite",
      // aggroRange: 3
    },

    loot: {
      lootTable: "measly",
      items: [
        { id: "contaminated_rat_meat", chance: 0.11 },
        { id: "slag_fur_scrap", chance: 0.20 }
      ]
    },

    ...overrides
  };
}

module.exports = { slagRat };