const { ObjectId } = require("mongodb");
const { broadcastInventoryUpdate } = require("../utils/inventory");

async function getInventory(req, res) {
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

    // NEW: inventory contains objects
    const itemIds = inventory
      .filter(slot => slot && slot.itemId)
      .map(slot => new ObjectId(slot.itemId));

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

    const slots = inventory.map(slot =>
      !slot || !slot.itemId
        ? null
        : {
            ...itemMap[slot.itemId],
            qty: slot.qty || 1
          }
    );

    res.json({ slots });

  } catch (err) {
    console.error("Inventory error:", err);
    res.status(500).json({ message: "Server error" });
  }
}

async function pickupItem(req, res) {
  try {
    const db = req.app.locals.db;
    const io = req.app.locals.io;

    const { playerId } = req.params;
    const { itemId } = req.body;

    if (!/^[a-fA-F0-9]{24}$/.test(playerId)) {
      return res.status(400).json({ message: "Invalid player ID" });
    }
    if (!/^[a-fA-F0-9]{24}$/.test(itemId)) {
      return res.status(400).json({ message: "Invalid item ID" });
    }

    const playersCol = db.collection("player_data");

    const player = await playersCol.findOne({ _id: new ObjectId(playerId) });
    if (!player) return res.status(404).json({ message: "Player not found" });

    const inv = player.inventory || [];

    const emptyIndex = inv.findIndex(s => !s || !s.itemId);
    if (emptyIndex === -1) {
      return res.status(400).json({ message: "Inventory full" });
    }

    inv[emptyIndex] = { itemId, qty: 1 };

    await playersCol.updateOne(
      { _id: new ObjectId(playerId) },
      { $set: { inventory: inv } }
    );

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
}

module.exports = {
  getInventory,
  pickupItem,
};
