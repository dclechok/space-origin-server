function broadcastInventoryUpdate(io, playerId, updatedSlots) {
  io.to(playerId).emit("inventory:update", updatedSlots);
}

module.exports = { broadcastInventoryUpdate };
