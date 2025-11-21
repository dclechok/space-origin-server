const router = require("express").Router();

router.use("/auth", require("./authRoutes"));
router.use("/accounts", require("./accountRoutes"));
router.use("/characters", require("./characterRoutes"));

module.exports = router;
