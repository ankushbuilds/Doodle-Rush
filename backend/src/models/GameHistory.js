import mongoose from "mongoose";

const gameHistorySchema = new mongoose.Schema({
  roomCode: { type: String, required: true },
  players: [{
    username: { type: String, required: true },
    score: { type: Number, required: true }
  }],
  rounds: { type: Number, required: true },
  completedAt: { type: Date, default: Date.now }
});

export default mongoose.model("GameHistory", gameHistorySchema);
