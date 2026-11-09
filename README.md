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


During a drawing turn, guessers see word blanks and receive a server-synchronized letter hint after 20 seconds, then every 15 seconds. The drawer sees the complete word. Sound effects can be enabled or muted and adjusted with the volume slider in the lobby or game; the preference is saved in that browser. Supported mobile devices also receive haptic feedback for key game events.

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






I want to add three new features to my existing Doodle Rush multiplayer drawing game: Live Reactions, Drawing Replay, and Funny Awards.

IMPORTANT: First inspect the complete existing project architecture, Socket.IO events, roomManager.js, drawing implementation, game state, scoring system, round lifecycle, and frontend components. Implement these features directly into the existing codebase.

Do not rewrite unrelated functionality or break existing multiplayer features.

# 1. LIVE REACTIONS

Add real-time emoji reactions during an active game.

Requirements:
- Show a compact reaction bar near the game canvas or chat area.
- Include these emojis: 😂 ❤️ 🔥 💀 😭 👏 🤯.
- Any connected player can send a reaction with one click.
- Broadcast reactions to all players in the same room using Socket.IO.
- Display reactions as small floating animations near the sender's player name or canvas.
- Automatically remove reaction animations after approximately 2 seconds.
- Multiple reactions should work simultaneously.
- Prevent reaction spam using a small server-side rate limit.
- Reactions must be room-specific.
- Do not allow reactions from players who are not members of the room.
- Do not interfere with drawing, chat, guessing, or game timers.
- Make the reaction bar mobile-friendly and responsive.

# 2. DRAWING REPLAY

Add a replay feature that allows players to watch how a completed drawing was created.

Requirements:
- Record drawing strokes on the server during each round.
- Preserve the original order of strokes and their timing.
- Record necessary drawing actions such as:
  - Stroke start and movement.
  - Stroke color.
  - Stroke width.
  - Eraser actions.
  - Clear canvas actions.
  - Undo actions, if supported by the existing drawing system.
- Save a timestamp for every drawing action relative to the beginning of the round.
- When a round ends, preserve its drawing history.
- Show a "Watch Replay" button after the round finishes.
- Replay the drawing on the existing canvas in chronological order.
- Include Play/Pause, Restart, and a playback speed selector (1x, 2x, 4x).
- Display a replay progress bar.
- Allow players to leave replay and return to the normal game screen.
- Ensure replay does not emit live drawing events or modify the actual game state.
- Support replay for every completed round, not just the latest round.
- Keep replay data isolated between rooms.
- Clear temporary replay state when the room is permanently deleted.

IMPORTANT PERFORMANCE RULES:
- Avoid sending unnecessary full canvas snapshots for every mouse movement.
- Reuse the existing drawing event structure wherever possible.
- Use compact event storage and avoid memory leaks.
- Set a reasonable maximum replay history size.
- Handle empty drawings and rounds that end unexpectedly.

# 3. FUNNY AWARDS

Generate funny awards automatically when the entire match ends.

Create awards based on actual game statistics, not random assignment.

Include awards such as:

- Fastest Guesser: player with the fastest correct guess.
- Worst Artist: player whose drawings received the fewest correct guesses, with a suitable minimum participation requirement.
- Human AI: player with the most correct guesses.
- Chaos Creator: player who generated the most drawing activity or reactions, depending on available statistics.
- Speed Demon: player with the highest average drawing completion speed or fastest successful rounds.
- Crowd Favorite: player whose drawings received the most reactions.
- Comeback King/Queen: player who recovered from a low score to achieve the highest improvement.

Requirements:
- Calculate awards on the backend after the final round.
- Use actual room/game statistics.
- Handle ties fairly.
- Do not assign awards to players who did not participate sufficiently.
- Avoid awarding the same player every award unless their statistics genuinely justify it.
- If there is insufficient data for an award, skip it rather than inventing a winner.
- Broadcast the final awards to every player in the room.
- Show a dedicated, visually appealing Match Results screen with player names, scores, rankings, and funny awards.
- Preserve the existing Doodle Rush graphite and copper theme.
- Make the results screen responsive on mobile.

# 4. SOCKET.IO AND SECURITY

- Use the existing Socket.IO connection and room architecture.
- Validate all reaction and drawing events on the server.
- Ensure players can only interact with rooms they have joined.
- Prevent clients from submitting fake award statistics.
- Server must remain authoritative for game events and final awards.
- Keep separate state for every room.
- Clean up timers, event listeners, and temporary data correctly.
- Handle disconnects and reconnects without corrupting replay data.
- Do not broadcast unnecessary large payloads.

# 5. TESTING REQUIREMENTS

Test these scenarios:

1. Two or more players send reactions simultaneously.
2. Reactions are visible only to players in the same room.
3. Reaction animations disappear automatically.
4. A completed round can be replayed accurately.
5. Replay supports pause, resume, restart and speed changes.
6. Undo and clear canvas actions are reproduced correctly in replay.
7. Multiple rounds maintain separate replay histories.
8. Funny awards are generated from actual match statistics.
9. All players receive the same final results and awards.
10. Different rooms never share reactions, replay history or award data.
11. Existing drawing, guessing, chat, hints, scoring, settings, room joining, reconnection and round progression continue working.

# 6. IMPLEMENTATION RULES

- Inspect existing code before modifying it.
- Reuse existing components, event names and drawing structures wherever possible.
- Do not introduce unnecessary dependencies.
- Do not create disconnected demo components.
- Do not hardcode fake player statistics.
- Avoid duplicating existing game state.
- Preserve the existing UI design and folder structure.
- Keep the implementation simple and maintainable.

After implementation:
1. Explain the architecture of each feature.
2. List every modified and newly created file.
3. Explain all new Socket.IO events.
4. Explain how drawing replay data is stored and cleaned up.
5. Explain how funny awards are calculated.
6. Report which test scenarios were actually verified.

Implement all three features fully, not just their frontend UI.