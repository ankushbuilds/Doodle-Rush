
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

const PORT = Number(process.env.PORT) || 3001;

// =====================================
// CORS CONFIGURATION
// =====================================

const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  process.env.CLIENT_ORIGIN,
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : null,
].filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;

  // Exact configured origins
  if (allowedOrigins.includes(origin)) return true;

  // Allow official Vercel deployment and preview subdomains
  try {
    const url = new URL(origin);

    if (
      url.protocol === "https:" &&
      url.hostname.endsWith(".vercel.app")
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
};

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    console.warn("Blocked CORS request from:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST"],
  credentials: true,
};

// =====================================
// EXPRESS MIDDLEWARE
// =====================================

app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

// =====================================
// HEALTH CHECK
// =====================================

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "DoodleRush backend is running!",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
  });
});

// =====================================
// GAME HISTORY
// =====================================

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

    return res.status(200).json(games);
  } catch (error) {
    next(error);
  }
});

// =====================================
// ERROR HANDLER
// =====================================

app.use((error, _req, res, _next) => {
  console.error("HTTP request failed:", error.message);

  if (error.message === "Not allowed by CORS") {
    return res.status(403).json({
      error: "Origin not allowed by CORS.",
    });
  }

  return res.status(500).json({
    error: "An unexpected server error occurred.",
  });
});

// =====================================
// SOCKET.IO
// =====================================

const io = new Server(server, {
  cors: corsOptions,
  maxHttpBufferSize: 1e6,
  transports: ["polling", "websocket"],
});

io.engine.on("connection_error", (error) => {
  console.error("Socket.IO connection error:", {
    code: error.code,
    message: error.message,
    context: error.context,
  });
});

// =====================================
// GAME ROOM HANDLERS
// =====================================

attachRoomHandlers(io, async (game) => {
  if (mongoose.connection.readyState !== 1) {
    console.warn("Game history not saved: MongoDB unavailable.");
    return;
  }

  try {
    await GameHistory.create(game);
    console.log("Game history saved successfully.");
  } catch (error) {
    console.error("Failed to save game history:", error.message);
  }
});

// =====================================
// SERVER START
// =====================================

server.listen(PORT, "0.0.0.0", () => {
  console.log(`DoodleRush server running on port ${PORT}`);
  console.log("Allowed frontend origins:", allowedOrigins);
});

// =====================================
// MONGODB
// =====================================

if (process.env.MONGO_URI) {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => {
      console.log("Connected to MongoDB successfully.");
    })
    .catch((error) => {
      console.error("MongoDB connection failed:", error.message);
    });
} else {
  console.warn("MONGO_URI is missing from environment variables.");
}
