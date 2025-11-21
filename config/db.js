const { MongoClient, ServerApiVersion } = require("mongodb");

let db;

async function connectDB() {
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  await client.connect();
  db = client.db(process.env.DB_NAME);
  console.log("🔥 Connected to MongoDB:", process.env.DB_NAME);

  return db;
}

function getDB() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

module.exports = { connectDB, getDB };
