module.exports = function socketHandler(io) {

  // Optional: store last 50 messages per region
  const regionHistory = {};

  io.on("connection", (socket) => {
    console.log("🔥 Client connected:", socket.id);


    // ======================================================
    // 🔵 REGIONAL CHAT SYSTEM
    // ======================================================
    socket.on("joinRegion", (region) => {
      if (!region) return;

      console.log(`📡 ${socket.id} joined region: ${region}`);
      socket.join(region);

      const history = regionHistory[region] || [];
      socket.emit("chatHistory", history);
    });

    socket.on("sendMessage", (data) => {
      const { region, user, message } = data;
      if (!region || !message) return;

      const msg = {
        id: Date.now(),
        region,
        user,
        message,
        time: new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      regionHistory[region] ||= [];
      regionHistory[region].push(msg);

      // Keep only last 50
      if (regionHistory[region].length > 50) {
        regionHistory[region].shift();
      }

      io.to(region).emit("newMessage", msg);
      console.log(`💬 Message to region '${region}':`, msg);
    });



    // ======================================================
    // 🔵 SCENE LOADING LOGIC (FIXED THE RIGHT WAY)
    // ======================================================
    socket.on("loadScene", async ({ x, y }) => {
      console.log("📥 loadScene request:", x, y);

      try {
        const db = require("../config/db").getDB();

        const scene = await db.collection("scene_data").findOne({
          x: Number(x),
          y: Number(y)
        });

        if (!scene) {
          console.warn(`⚠️ Scene not found at (${x}, ${y})`);
          return socket.emit("sceneError", {
            error: `Scene [${x}, ${y}] not found`
          });
        }

        console.log(`📤 Sending sceneData for (${x}, ${y})`);
        socket.emit("sceneData", scene);

      } catch (err) {
        console.error("❌ Scene load error:", err);
        socket.emit("sceneError", {
          error: "Server error loading scene"
        });
      }
    });



    // ======================================================
    // 🔵 DISCONNECT
    // ======================================================
    socket.on("disconnect", () => {
      console.log("❌ Client disconnected:", socket.id);
    });
  });
};
