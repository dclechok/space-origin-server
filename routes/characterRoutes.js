const router = require("express").Router();
const auth = require("../middleware/auth");
const CharacterController = require("../controllers/characterController");

router.post("/byIds", auth, CharacterController.getCharactersByIds);

module.exports = router;
