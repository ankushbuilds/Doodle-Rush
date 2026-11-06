# 🎨 DoodleRush

### Draw It. Guess It. Beat Your Friends!

DoodleRush is a real-time multiplayer drawing and guessing game where players compete to guess secret words while taking turns creating drawings. Create a private room, invite friends, and enjoy an interactive drawing experience powered by Socket.IO.

Built with React, Node.js, Express, and Socket.IO, DoodleRush focuses on real-time communication, synchronized gameplay, and a smooth multiplayer experience.

## ✨ Features

- 🎮 **Real-Time Multiplayer:** Play with friends in synchronized game rooms.
- 🏠 **Private Game Rooms:** Create rooms and invite players using a six-character room code or invite URL.
- 🎨 **Interactive Drawing Canvas:** Draw and share sketches with other players in real time.
- 🧠 **Secret Word Selection:** Drawers privately choose one word from three available options.
- 💬 **Live Guessing:** Players submit guesses while the drawing is happening.
- ⏱️ **Customizable Rounds:** Configure 1–8 rounds and 30–180 seconds per drawing turn.
- 🏆 **Scoring System:** Earn points for correct guesses and drawing.
- 🔄 **Reconnection Support:** Players can refresh and resume their game using a browser-saved room token.
- 🔐 **Server-Authoritative Gameplay:** Rooms, scores, words, timers, drawing validation, and round progression are controlled by the backend.
- 📊 **Game History:** Completed game rankings can be stored and retrieved using MongoDB.
- ⚡ **Live Synchronization:** Socket.IO keeps game events and drawing updates synchronized across connected players.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| React | Frontend user interface |
| Vite | Frontend development and build |
| JavaScript | Application logic |
| Node.js | Backend runtime |
| Express.js | Server and HTTP endpoints |
| Socket.IO | Real-time multiplayer communication |
| MongoDB | Persistent completed game history |

## 🏗️ Project Architecture

DoodleRush consists of two separate applications:

```text
DoodleRush/
│
├── backend/
│   ├── src/
│   │   └── game/
│   │       └── roomManager.js
│   ├── .env.example
│   └── package.json
│
├── frontend/
│   ├── src/
│   └── package.json
│
└── README.md
```

**Backend responsibilities:**
- Room creation and player management.
- Secret word selection and validation.
- Game timers and round progression.
- Drawing event validation and synchronization.
- Score calculation and game completion.
- Optional MongoDB game history storage.

**Frontend responsibilities:**
- Game interface and drawing canvas.
- Room creation and joining.
- Real-time player and game updates.
- Guess submission and score display.
- Reconnection and game interaction.

## ⚙️ Requirements

- Node.js 18 or newer
- npm
- MongoDB (Optional — required only for persistent game history)

## 🚀 Getting Started

Follow these steps to run DoodleRush locally.

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/DoodleRush.git
cd DoodleRush
```

### 2. Configure the Backend

Navigate to the backend directory:

```bash
cd backend
npm install
```

Create your environment file using the example:

```bash
copy .env.example .env
```

Configure the environment variables in `.env`.

Set `MONGO_URI` to your MongoDB connection string if you want to enable persistent game history.

**Note:** MongoDB is optional. The game server can run without it, but completed game history will not be persisted.

### 3. Start the Backend

```bash
npm run dev
```

### 4. Configure and Start the Frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

### 5. Open the Application

Open the Vite development URL in your browser:

```text
http://localhost:5173
```

Open the application in two or more browser sessions to test multiplayer gameplay.

**For deployment or access from another host:**
- Set `CLIENT_ORIGIN` in the backend.
- Set `VITE_SERVER_URL` in the frontend.

Configure these values before starting the applications.

## 🎯 How to Play

1. Create a game room.
2. Share the six-character room code or invite URL with friends.
3. Wait for at least one other player to join.
4. The host configures the number of rounds and drawing duration.
5. The host starts the game.
6. The selected drawer privately chooses one of three words.
7. The drawer sketches the word while other players try to guess it.
8. Correct guesses earn points, and drawers also receive points.
9. Players take turns drawing until all rounds are completed.
10. Check the final rankings and game results!

### Game Configuration

| Setting | Available Options |
|---|---|
| Number of rounds | 1–8 |
| Drawing duration | 30–180 seconds |
| Word selection | 3 choices per turn |
| Room code | 6 characters |
| Reconnection window | 45 seconds |

## 🔌 API & Real-Time Communication

### HTTP Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Reports server health |
| GET | `/api/history` | Retrieves the latest 20 completed games when MongoDB is connected |

### Socket.IO Events

Real-time game events are implemented in:

```text
backend/src
