const { ObjectId, isValidObjectId } = require("mongodb");

exports.getCharactersForAccount = async (req, res) => {
  try {
    const accountId = req.params.id;

    if (!ObjectId.isValid(accountId)) {
      console.log("Invalid ObjectId:", accountId);
      return res.json({ characters: [] });
    }

    const db = req.app.locals.db;
    const accounts = db.collection("player_data");

    const account = await accounts.findOne(
      { _id: new ObjectId(accountId) },
      { projection: { passwordHash: 0 } }
    );

    if (!account) return res.json({ characters: [] });

    res.json({ characters: account.characters || [] });

  } catch (err) {
    console.error("Character fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
