const express = require("express");
const router = express.Router();
const {
  getRegionById,
  getSceneByCoords,
  getSceneById, 
  getAllScenes
} = require("../controllers/mapController");
const auth = require("../middleware/auth");

router.get("/region/:regionId", auth, getRegionById);
router.get("/scene/:regionId/:x/:y", auth, getSceneByCoords);
router.get("/scene/id/:sceneId", auth, getSceneById);
router.get("/scenes", auth, getAllScenes);


module.exports = router;
