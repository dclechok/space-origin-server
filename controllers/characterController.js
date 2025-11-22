const { ObjectId } = require("mongodb");

exports.getCharactersForAccount = async (req, res) => {
  try {
    const accountId = req.params.id;

    if (!ObjectId.isValid(accountId)) {
      console.log("Invalid accountId:", accountId);
      return res.json({ characters: [] });
    }

    const db = req.app.locals.db;

    const usersCol = db.collection("accounts");
    const charsCol = db.collection("player_data");

    // Find the user account
    const user = await usersCol.findOne(
      { _id: new ObjectId(accountId) },
      { projection: { passwordHash: 0 } }
    );

    if (!user) {
      console.log("User not found:", accountId);
      return res.json({ characters: [] });
    }

    // User.characters contains the character IDs
    const characterIds = (user.characters || []).filter(id => id);

    if (characterIds.length === 0) {
      return res.json({ characters: [] });
    }

    // Convert all IDs to ObjectId
    const objectIds = characterIds.map(id => new ObjectId(id));

    // Fetch all character documents from player_data
    const characters = await charsCol
      .find(
        { _id: { $in: objectIds } },
        { projection: { passwordHash: 0 } }
      )
      .toArray();

    // Return them
    res.json({ characters });

  } catch (err) {
    console.error("Character fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
