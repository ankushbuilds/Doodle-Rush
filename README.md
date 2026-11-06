# DoodleRush

A real-time multiplayer drawing and guessing game. The frontend and Socket.IO/Express backend are separate apps. Rooms, scores, secret words, timers, drawing validation, and round progression are server-controlled. Active rooms live in memory; completed game rankings are saved to MongoDB when it is configured.

## Requirements

- Node.js 18 or newer
- npm
- MongoDB (optional; required only for persistent game history)

## Run locally

1. In `backend`, install dependencies and create `.env` from `.env.example`.
2. Set `MONGO_URI` to a MongoDB connection string to enable history storage. The game server still runs without MongoDB.
3. Start the server:

   ```sh
   cd backend
   npm install
   npm run dev
   ```

4. In a second terminal, install and start the frontend:

   ```sh
   cd frontend
   npm install
   npm run dev
   ```

5. Open the Vite URL (normally `http://localhost:5173`) in two or more browser sessions. To run on another host, set `CLIENT_ORIGIN` in the backend and `VITE_SERVER_URL` in the frontend before starting the apps.

## Play

Create a room, share its six-character code or invite URL, and have at least one other player join. The host can configure 1–8 rounds and 30–180 seconds per drawing turn. The host starts the game; each drawer privately chooses one of three words. Drawing is synchronized live, guesses are checked on the server, and scores are awarded for correct guesses and drawing. Players can refresh and resume using their browser's saved room token (held for 45 seconds after disconnect).

## Server endpoints and events

- `GET /api/health` reports server health.
- `GET /api/history` lists the latest 20 completed games when MongoDB is connected.
- Socket.IO events are implemented under `backend/src/game/roomManager.js`; the React client uses the same event names from `frontend/src`.
