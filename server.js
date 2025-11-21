require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { connectDB } = require("./config/db");
const routes = require("./routes");

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());

async function startServer() {
  const db = await connectDB();
  app.locals.db = db;
  app.locals.io = io; // <-- make io available everywhere

  app.use("/api", routes);

  io.on("connection", (socket) => {
    console.log("🔥 Client connected:", socket.id);
  });

  const PORT = process.env.PORT || 5000;
  httpServer.listen(PORT, () =>
    console.log(`🚀 Server with WebSockets running on port ${PORT}`)
  );
}

startServer();
