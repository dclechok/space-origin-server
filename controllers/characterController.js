const { ObjectId } = require("mongodb");

exports.getCharactersForAccount = async (req, res) => {
  try {
    const db = req.app.locals.db;
    const accounts = db.collection("player_data");

    const accountId = req.params.id;

    const account = await accounts.findOne(
      { _id: new ObjectId(accountId) },
      { projection: { passwordHash: 0 } }
    );

    if (!account) {
      return res.json({ characters: [] });
    }

    res.json({ characters: account.characters || [] });

  } catch (err) {
    console.error("Character fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
