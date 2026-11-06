
import "dotenv/config";
import http from "node:http";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { Server } from "socket.io";

import GameHistory from "./models/GameHistory.js";
import { attachRoomHandlers } from "./game/roomManager.js";

const app = express();
const server = http.createServer(app);

// Frontend origins
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  process.env.CLIENT_ORIGIN,
].filter(Boolean);

// CORS configuration
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Game history
app.get("/api/history", async (_req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: "Game history is unavailable until MongoDB is connected.",
      });
    }

    const games = await GameHistory.find()
      .sort({ completedAt: -1 })
      .limit(20)
      .lean();

    res.json(games);
  } catch (error) {
    next(error);
  }
});

// Error handler
app.use((error, _req, res, _next) => {
  console.error("HTTP request failed:", error);

  res.status(500).json({
    error: "An unexpected server error occurred.",
  });
});

// Socket.IO configuration
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
  maxHttpBufferSize: 1e6,
});

// Attach game room handlers
attachRoomHandlers(io, (game) => {
  if (mongoose.connection.readyState !== 1) return;

  return GameHistory.create(game);
});

// Server configuration
const port = Number(process.env.PORT) || 3001;

server.listen(port, "0.0.0.0", () => {
  console.log(`DoodleRush server running on port ${port}`);
});

// MongoDB connection
if (process.env.MONGO_URI) {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log("Connected to MongoDB"))
    .catch((error) => {
      console.error("MongoDB connection failed:", error.message);
    });
} else {
  console.warn("MONGO_URI is missing from environment variables.");
}
