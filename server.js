// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

// ====== Middleware ======
app.use(cors());
app.use(express.json());

// ====== Config ======
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "reverie_dev";
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is not set in .env");
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error("❌ JWT_SECRET is not set in .env");
  process.exit(1);
}

// ====== MongoDB Setup ======
const client = new MongoClient(MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db; // will hold the connected DB instance

async function connectDB() {
  try {
    await client.connect();
    db = client.db(DB_NAME);
    await db.command({ ping: 1 });
    console.log(`✅ Connected to MongoDB database: ${DB_NAME}`);
  } catch (err) {
    console.error("❌ Error connecting to MongoDB:", err);
    process.exit(1);
  }
}

function getUsersCollection() {
  if (!db) throw new Error("Database not initialized");
  return db.collection("player_data");
}

// ====== Auth Helpers ======
function generateToken(user) {
  return jwt.sign(
    {
      id: user._id,
      username: user.username,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing or invalid Authorization header" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // attach decoded payload to req.user
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// ====== Routes ======

// Simple health check
app.get("/", (req, res) => {
  res.json({ message: "Reverie API is running 🚀" });
});

// Register a new user
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: "username, email, and password are required" });
    }

    const users = getUsersCollection();

    // Check if user already exists
    const existing = await users.findOne({
      $or: [{ email }, { username }],
    });

    if (existing) {
      return res.status(409).json({ message: "Username or email already in use" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await users.insertOne({
      username,
      email,
      passwordHash,
      createdAt: new Date(),
    });

    const newUser = { _id: result.insertedId, username, email };
    const token = generateToken(newUser);

    res.status(201).json({
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
      },
      token,
    });
  } catch (err) {
    console.error("Error in /api/auth/register:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, unhashedPass } = req.body;
    if (!username || !unhashedPass) {
      return res.status(400).json({ message: "username and password are required" });
    }

    const users = getUsersCollection();

    const user = await users.findOne( { username: username });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials - user not found" });
    }

    const isMatch = await bcrypt.compare(unhashedPass, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials - password does not match" });
    }

    const token = generateToken(user);

    res.json({
      user: {
        id: user._id,
        username: user.username,
      },
      token,
    });
  } catch (err) {
    console.error("Error in /api/auth/login:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Example protected route
app.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const users = getUsersCollection();
    const user = await users.findOne(
      { _id: new require("mongodb").ObjectId(req.user.id) },
      { projection: { passwordHash: 0 } } // don't return passwordHash
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ user });
  } catch (err) {
    console.error("Error in /api/auth/me:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ====== Start Server ======
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});
