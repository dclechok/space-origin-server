const router = require("express").Router();
const auth = require("../middleware/auth");
const Auth = require("../controllers/authController");

router.post("/register", Auth.register);
router.post("/login", Auth.login);
router.get("/me", auth, Auth.me);

module.exports = router;