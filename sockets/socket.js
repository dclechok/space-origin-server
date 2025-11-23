module.exports = function socketHandler(io) {
  io.on("connection", (socket) => {
    console.log("🔥 Client connected:", socket.id);

    socket.on("loadScene", async ({ x, y }) => {
      console.log("📥 loadScene:", x, y);

io.on("connection", (socket) => {
  console.log("🔥 SOCKET CONNECT:", socket.handshake.headers);
});


      try {
        const db = require("../config/db").getDB();

        const scene = await db.collection("scene_data").findOne({
          x: parseInt(x),
          y: parseInt(y)
        });

        if (!scene) {
          return socket.emit("mapData", {
            error: "Scene not found",
          });
        }

        socket.emit("mapData", scene);

      } catch (err) {
        console.error("Scene load error:", err);
        socket.emit("mapData", { error: "Server error loading scene" });
      }
    });

    socket.on("disconnect", () => {
      console.log("❌ Client disconnected");
    });
  });
};
