// controllers/inventoryController.js
const { ObjectId } = require("mongodb");
const { broadcastInventoryUpdate } = require("../utils/inventory");

// =========================================
// GET INVENTORY (already working)
// =========================================
exports.getInventory = async function(req, res) {
  try {
    const db = req.app.locals.db;
    const playerId = req.params.playerId;

    if (!/^[a-fA-F0-9]{24}$/.test(playerId)) {
      return res.status(400).json({ message: "Invalid player ID" });
    }

    const playersCol = db.collection("player_data");
    const itemsCol = db.collection("item_data");

    const player = await playersCol.findOne({ _id: new ObjectId(playerId) });
    if (!player) return res.status(404).json({ message: "Player not found" });

    const inventory = player.inventory || [];

    const itemIds = inventory
      .filter(id => id && id !== "0" && /^[a-fA-F0-9]{24}$/.test(id))
      .map(id => new ObjectId(id));

    const itemDocs = itemIds.length
      ? await itemsCol.find({ _id: { $in: itemIds } }).toArray()
      : [];

    const itemMap = {};
    for (const doc of itemDocs) {
      itemMap[doc._id.toString()] = {
        id: doc._id.toString(),
        name: doc.name,
        desc: doc.desc,
        lootClass: doc.lootClass,
        graphic: doc.graphic,
        maxStackSize: doc.maxStackSize,
        stackable: doc.stackable,
      };
    }

    const slots = inventory.map(id =>
      !id || id === "0" ? null : itemMap[id] || null
    );

    res.json({ slots });

  } catch (err) {
    console.error("Inventory controller error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================================
// PICK UP AN ITEM — NEW
// =========================================
exports.pickupItem = async function(req, res) {
  try {
    const db = req.app.locals.db;
    const io = req.app.locals.io; // 🔥 socket available here

    const { playerId } = req.params;
    const { itemId } = req.body;

    // Validate IDs
    if (!/^[a-fA-F0-9]{24}$/.test(playerId)) {
      return res.status(400).json({ message: "Invalid player ID" });
    }
    if (!/^[a-fA-F0-9]{24}$/.test(itemId)) {
      return res.status(400).json({ message: "Invalid item ID" });
    }

    const playersCol = db.collection("player_data");

    // Fetch the player
    const player = await playersCol.findOne({ _id: new ObjectId(playerId) });
    if (!player) return res.status(404).json({ message: "Player not found" });

    const inv = player.inventory || [];

    // Find first empty slot ("0" or null)
    const emptyIndex = inv.findIndex(s => !s || s === "0" || s === "");
    if (emptyIndex === -1) {
      return res.status(400).json({ message: "Inventory full" });
    }

    // Insert item into slot
    inv[emptyIndex] = itemId;

    // Update database
    await playersCol.updateOne(
      { _id: new ObjectId(playerId) },
      { $set: { inventory: inv } }
    );

    // 🔥 Send update to client(s)
    broadcastInventoryUpdate(io, playerId, inv);

    return res.json({
      message: "Item picked up",
      updatedInventory: inv,
      changedSlot: emptyIndex
    });

  } catch (err) {
    console.error("Pickup error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
