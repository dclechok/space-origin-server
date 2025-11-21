const router = require("express").Router();

router.use("/auth", require("./authRoutes"));
router.use("/accounts", require("./accountRoutes"));
router.use("/characters", require("./characterRoutes"));
router.use("/inventory", require("./inventoryRoutes"));

module.exports = router;
