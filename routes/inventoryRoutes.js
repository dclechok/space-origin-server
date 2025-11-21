// routes/inventoryRoutes.js
const router = require("express").Router();
const auth = require("../middleware/auth");
const Inventory = require("../controllers/inventoryController");

// GET /api/inventory/:playerId
router.get("/:playerId", auth, Inventory.getInventory);
router.post("/:playerId/pickup", auth, Inventory.pickupItem);

module.exports = router;
