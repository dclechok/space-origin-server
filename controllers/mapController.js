const { getDB } = require("../config/db");

// ===============================
// GET REGION BY ID
// ===============================
exports.getRegionById = async (req, res) => {
  try {
    const db = getDB();
    const regionId = req.params.regionId;

    const region = await db
      .collection("region_data")
      .findOne({ id: regionId });

    if (!region) {
      return res.status(404).json({ message: "Region not found" });
    }

    res.json({ region });
  } catch (err) {
    console.error("Error fetching region:", err);
    res.status(500).json({ message: "Server error fetching region" });
  }
};

// ===============================
// GET SCENE BY COORDINATES
// ===============================
exports.getSceneByCoords = async (req, res) => {
  try {
    const db = getDB();
    const { regionId, x, y } = req.params;

    const scene = await db
      .collection("scene_data")
      .findOne({
        regionId: regionId,
        x: parseInt(x),
        y: parseInt(y)
      });

    if (!scene) {
      return res.status(404).json({ message: "Scene not found" });
    }

    res.json({ scene });
  } catch (err) {
    console.error("Error fetching scene by coords:", err);
    res.status(500).json({ message: "Server error fetching scene" });
  }
};

exports.getSceneById = async (req, res) => {
  try {
    const db = getDB();
    const sceneId = req.params.sceneId;

    const scene = await db
      .collection("scene_data")
      .findOne({ id: sceneId });

    if (!scene) {
      return res.status(404).json({ message: "Scene not found" });
    }

    res.json({ scene });
  } catch (err) {
    console.error("Error fetching scene by ID:", err);
    res.status(500).json({ message: "Server error fetching scene" });
  }
};

// ===============================
// GET ALL SCENES
// ===============================
exports.getAllScenes = async (req, res) => {
  try {
    const db = getDB();

    const scenes = await db
      .collection("scene_data")
      .find({})
      .toArray();

    res.json({ scenes });
  } catch (err) {
    console.error("Error fetching all scenes:", err);
    res.status(500).json({ message: "Server error fetching scenes" });
  }
};
