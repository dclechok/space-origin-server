const { ObjectId } = require("mongodb");

exports.getCharactersByIds = async (req, res) => {
  try {
    const db = req.app.locals.db;
    const collection = db.collection("player_data");

    const { ids } = req.body;

    const cleanIds = ids.filter(id => id && id.trim() !== "");
    const objIds = cleanIds.map(id => new ObjectId(id));

    const chars = await collection.find({
      _id: { $in: objIds }
    }).toArray();

    res.json({ characters: chars });

  } catch (err) {
    console.error("Character fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
