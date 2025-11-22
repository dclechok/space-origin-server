const express = require("express");
const router = express.Router();
const { getCharactersForAccount } = require("../controllers/characterController");
const auth = require("../middleware/auth");

router.get("/:id", auth, getCharactersForAccount);

module.exports = router;
