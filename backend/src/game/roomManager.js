
import { randomBytes, randomUUID } from "node:crypto";
import { chooseWords, normalizeWord } from "./words.js";

// ============================================================
// CONSTANTS & ROOM STORAGE
// ============================================================

const rooms = new Map();

const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;

const RECONNECT_GRACE_MS = 45_000;
const ROUND_PAUSE_MS = 5_000;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

// Generate a unique room code
function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code;

  do {
    code = Array.from(
      randomBytes(6),
      (byte) => alphabet[byte % alphabet.length]
    ).join("");
  } while (rooms.has(code));

  return code;
}

// Clean and validate username
function cleanName(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 18)
    : "";
}

// Support callback as first or second argument
function getCallback(first, second) {
  return typeof second === "function"
    ? second
    : typeof first === "function"
      ? first
      : undefined;
}

// Return only public player information
function publicPlayer(player) {
  return {
    id: player.id,
    username: player.username,
    score: player.score,
    ready: player.ready,
    connected: player.connected,
  };
}

// Generate partially revealed word hint
function hintPattern(word, guessedCount) {
  const chars = [...word];

  const reveal = Math.min(
    chars.length - 1,
    guessedCount
  );

  const revealed = new Set();

  while (revealed.size < reveal) {
    revealed.add(
      Math.floor(Math.random() * chars.length)
    );
  }

  return chars
    .map((char, index) =>
      char === " " || revealed.has(index)
        ? char
        : "_"
    )
    .join(" ");
}

// ============================================================
// MAIN ROOM HANDLERS
// ============================================================

export function attachRoomHandlers(io, saveHistory) {

  // ==========================================================
  // TIMER MANAGEMENT
  // ==========================================================

  function clearTimer(room, key) {
    if (room[key]) {
      clearTimeout(room[key]);
    }

    room[key] = null;
  }

  // ==========================================================
  // ROOM STATE MANAGEMENT
  // ==========================================================

  // Send personalized room state to every connected player
  function emitState(room) {
    for (const player of room.players.values()) {
      if (!player.connected || !player.socketId) continue;

      const state = {
        code: room.code,
        phase: room.phase,

        players: [...room.players.values()].map(publicPlayer),

        hostId: room.hostId,

        settings: { ...room.settings },

        round: room.round,
        totalRounds: room.settings.rounds,

        drawerId: room.drawerId,
        endsAt: room.endsAt,

        strokes: room.strokes,

        guessedIds: [...room.guessed],

        playerId: player.id,

        yourTurn: room.drawerId === player.id,

        wordLength: room.word
          ? [...room.word].length
          : 0,

        hint:
          room.word && room.drawerId !== player.id
            ? hintPattern(room.word, room.guessed.size)
            : "",

        word:
          room.drawerId === player.id
            ? room.word
            : undefined,

        wordChoices:
          room.drawerId === player.id &&
          room.phase === "choosing"
            ? room.wordChoices
            : undefined,

        revealedWord:
          room.phase === "roundEnd" ||
          room.phase === "gameOver"
            ? room.word
            : undefined,
      };

      io.to(player.socketId).emit("room:state", state);
    }
  }

  // Broadcast an event to everyone in the room
  function broadcast(room, event, data) {
    io.to(room.code).emit(event, data);
  }

  // Find current socket's player and room
  function findPlayer(socket, code = socket.data.roomCode) {
    const room = rooms.get(code);

    const player = room?.players.get(
      socket.data.playerId
    );

    if (
      !room ||
      !player ||
      player.socketId !== socket.id
    ) {
      return null;
    }

    return { room, player };
  }

  // ==========================================================
  // RESPONSE HELPERS
  // ==========================================================

  function sendError(socket, callback, message) {
    const response = {
      ok: false,
      error: message,
    };

    if (typeof callback === "function") {
      callback(response);
    } else {
      socket.emit("app:error", response);
    }
  }

  function sendOk(callback, data = {}) {
    if (typeof callback === "function") {
      callback({
        ok: true,
        ...data,
      });
    }
  }

  // ==========================================================
  // GAME LIFECYCLE
  // ==========================================================

  // Select the next drawer
  function chooseDrawer(room) {
    const active = room.drawerOrder.filter(
      (id) => room.players.get(id)?.connected
    );

    if (!active.length) {
      return finishGame(room);
    }

    // Move to the next round when all players have drawn
    if (room.turnIndex >= room.drawerOrder.length) {
      room.round += 1;
      room.turnIndex = 0;
    }

    if (room.round > room.settings.rounds) {
      return finishGame(room);
    }

    const orderedActive = room.drawerOrder.filter(
      (id) => room.players.has(id)
    );

    if (!orderedActive.length) {
      return finishGame(room);
    }

    room.turnIndex %= orderedActive.length;

    room.drawerId = orderedActive[room.turnIndex];

    // Skip disconnected drawers
    if (!room.players.get(room.drawerId)?.connected) {
      room.turnIndex += 1;
      return chooseDrawer(room);
    }

    room.turnIndex += 1;

    // Reset turn data
    room.phase = "choosing";
    room.word = "";
    room.wordChoices = chooseWords();
    room.strokes = [];
    room.guessed = new Set();
    room.endsAt = null;

    emitState(room);

    // Automatically select the first word after 15 seconds
    room.choiceTimer = setTimeout(() => {
      if (
        room.phase === "choosing" &&
        room.drawerId &&
        room.wordChoices.length
      ) {
        if (room.players.get(room.drawerId)?.connected) {
          startDrawing(room, room.wordChoices[0]);
        } else {
          finishTurn(room);
        }
      }
    }, 15_000);
  }

  // Start the drawing phase
  function startDrawing(room, word) {
    clearTimer(room, "choiceTimer");

    room.word = word;
    room.wordChoices = [];
    room.phase = "drawing";

    room.endsAt =
      Date.now() + room.settings.roundDuration * 1000;

    room.turnTimer = setTimeout(
      () => finishTurn(room),
      room.settings.roundDuration * 1000
    );

    emitState(room);
  }

  // Finish the current player's turn
  function finishTurn(room) {
    clearTimer(room, "choiceTimer");
    clearTimer(room, "turnTimer");
    clearTimer(room, "pauseTimer");

    room.phase = "roundEnd";
    room.endsAt = null;

    broadcast(room, "round:ended", {
      word: room.word,

      scores: [...room.players.values()].map(publicPlayer),
    });

    emitState(room);

    room.pauseTimer = setTimeout(
      () => chooseDrawer(room),
      ROUND_PAUSE_MS
    );
  }

  // Finish the complete game
  function finishGame(room) {
    clearTimer(room, "choiceTimer");
    clearTimer(room, "turnTimer");
    clearTimer(room, "pauseTimer");

    room.phase = "gameOver";
    room.endsAt = null;
    room.drawerId = null;

    const ranking = [...room.players.values()]
      .map(publicPlayer)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.username.localeCompare(b.username)
      );

    broadcast(room, "game:over", {
      ranking,
      winner: ranking[0] ?? null,
    });

    emitState(room);

    // Save completed game history
    Promise.resolve(
      saveHistory?.({
        roomCode: room.code,

        players: ranking.map(
          ({ username, score }) => ({
            username,
            score,
          })
        ),

        rounds: room.settings.rounds,
      })
    ).catch((error) =>
      console.error(
        "Could not save game history:",
        error
      )
    );
  }

  // Start a new game
  function startGame(room) {
    clearTimer(room, "choiceTimer");

    room.phase = "choosing";
    room.round = 1;

    room.drawerOrder = [...room.players.keys()];
    room.turnIndex = 0;

    for (const player of room.players.values()) {
      player.score = 0;
    }

    chooseDrawer(room);
  }

  // Return room to lobby after game completion
  function returnToLobby(room) {
    clearTimer(room, "turnTimer");
    clearTimer(room, "choiceTimer");
    clearTimer(room, "pauseTimer");

    room.phase = "lobby";
    room.round = 0;

    room.drawerId = null;
    room.word = "";
    room.wordChoices = [];

    room.strokes = [];
    room.guessed.clear();

    room.endsAt = null;

    for (const member of room.players.values()) {
      member.score = 0;
      member.ready = member.id === room.hostId;
    }

    emitState(room);
  }

  // ==========================================================
  // PLAYER MANAGEMENT
  // ==========================================================

  // Remove a player from a room
  function removePlayer(room, playerId) {
    const player = room.players.get(playerId);

    if (!player) return;

    // Remove socket from room
    if (player.socketId) {
      const socket = io.sockets.sockets.get(
        player.socketId
      );

      socket?.leave(room.code);
    }

    room.players.delete(playerId);

    // Transfer host ownership
    if (room.hostId === playerId) {
      room.hostId =
        [...room.players.values()].find(
          (candidate) => candidate.connected
        )?.id ??
        room.players.keys().next().value ??
        null;

      broadcast(room, "room:host-changed", {
        hostId: room.hostId,
      });
    }

    // Handle drawer leaving
    if (
      room.phase === "choosing" &&
      room.drawerId === playerId
    ) {
      finishTurn(room);
    } else if (
      room.phase === "drawing" &&
      room.drawerId === playerId
    ) {
      finishTurn(room);
    } else if (room.phase === "drawing") {
      const guessers = [...room.players.values()].filter(
        (candidate) => candidate.id !== room.drawerId
      );

      if (
        guessers.length &&
        guessers.every((candidate) =>
          room.guessed.has(candidate.id)
        )
      ) {
        finishTurn(room);
      }
    }

    // Delete empty rooms
    if (!room.players.size) {
      clearTimer(room, "turnTimer");
      clearTimer(room, "choiceTimer");
      clearTimer(room, "pauseTimer");
      clearTimer(room, "emptyTimer");

      rooms.delete(room.code);

      return;
    }

    emitState(room);
  }

  // ==========================================================
  // SOCKET CONNECTION
  // ==========================================================

  io.on("connection", (socket) => {

    // ========================================================
    // ROOM CREATION
    // ========================================================

    socket.on("room:create", (payload = {}, callback) => {
      const username = cleanName(payload.username);

      if (!username) {
        return sendError(
          socket,
          callback,
          "Enter a username to create a room."
        );
      }

      const code = makeCode();

      const player = {
        id: randomUUID(),
        username,

        score: 0,
        ready: true,
        connected: true,

        socketId: socket.id,

        reconnectToken: randomBytes(24).toString("hex"),
      };

      const room = {
        code,

        players: new Map([[player.id, player]]),

        hostId: player.id,

        phase: "lobby",

        settings: {
          rounds: 3,
          roundDuration: 80,
        },

        round: 0,

        drawerId: null,
        drawerOrder: [],
        turnIndex: 0,

        word: "",
        wordChoices: [],

        strokes: [],
        guessed: new Set(),

        endsAt: null,
      };

      rooms.set(code, room);

      socket.join(code);

      socket.data.roomCode = code;
      socket.data.playerId = player.id;

      emitState(room);

      sendOk(callback, {
        code,
        playerId: player.id,
        reconnectToken: player.reconnectToken,
      });
    });

    // ========================================================
    // JOIN ROOM
    // ========================================================

    socket.on("room:join", (payload = {}, callback) => {
      const code =
        typeof payload.code === "string"
          ? payload.code.trim().toUpperCase()
          : "";

      const username = cleanName(payload.username);

      const room = rooms.get(code);

      if (!username) {
        return sendError(
          socket,
          callback,
          "Enter a username to join a room."
        );
      }

      if (!room || room.phase === "gameOver") {
        return sendError(
          socket,
          callback,
          "That room is not available."
        );
      }

      if (room.players.size >= MAX_PLAYERS) {
        return sendError(
          socket,
          callback,
          "This room is full (8 players maximum)."
        );
      }

      if (room.phase !== "lobby") {
        return sendError(
          socket,
          callback,
          "The game is already in progress."
        );
      }

      const usernameExists = [
        ...room.players.values(),
      ].some(
        (player) =>
          player.username.toLowerCase() ===
          username.toLowerCase()
      );

      if (usernameExists) {
        return sendError(
          socket,
          callback,
          "That username is already in this room."
        );
      }

      const player = {
        id: randomUUID(),
        username,

        score: 0,
        ready: false,
        connected: true,

        socketId: socket.id,

        reconnectToken: randomBytes(24).toString("hex"),
      };

      room.players.set(player.id, player);

      socket.join(code);

      socket.data.roomCode = code;
      socket.data.playerId = player.id;

      emitState(room);

      sendOk(callback, {
        code,
        playerId: player.id,
        reconnectToken: player.reconnectToken,
      });
    });

    // ========================================================
    // RECONNECT TO ROOM
    // ========================================================

    socket.on("room:resume", (payload = {}, callback) => {
      const code =
        typeof payload.code === "string"
          ? payload.code.trim().toUpperCase()
          : "";

      const room = rooms.get(code);

      const player =
        room &&
        [...room.players.values()].find(
          (candidate) =>
            candidate.reconnectToken ===
            payload.reconnectToken
        );

      if (!player) {
        return sendError(
          socket,
          callback,
          "Your saved room session has expired."
        );
      }

      clearTimeout(player.reconnectTimer);

      player.connected = true;
      player.socketId = socket.id;

      socket.join(code);

      socket.data.roomCode = code;
      socket.data.playerId = player.id;

      if (
        !room.hostId ||
        !room.players.get(room.hostId)?.connected
      ) {
        room.hostId = player.id;
      }

      emitState(room);

      sendOk(callback, {
        code,
        playerId: player.id,
        reconnectToken: player.reconnectToken,
      });
    });

    // ========================================================
    // PLAYER READY STATUS
    // ========================================================

    socket.on("player:ready", (payload = {}, callback) => {
      const found = findPlayer(socket);

      if (!found) {
        return sendError(
          socket,
          callback,
          "Join a room first."
        );
      }

      if (found.room.phase !== "lobby") {
        return sendError(
          socket,
          callback,
          "Ready status can only change in the lobby."
        );
      }

      found.player.ready = Boolean(payload.ready);

      emitState(found.room);

      sendOk(callback);
    });

    // ========================================================
    // ROOM SETTINGS
    // ========================================================

    socket.on("room:settings", (payload = {}, callback) => {
      const found = findPlayer(socket);

      if (!found) {
        return sendError(
          socket,
          callback,
          "Join a room first."
        );
      }

      const { room, player } = found;

      if (
        room.phase !== "lobby" ||
        room.hostId !== player.id
      ) {
        return sendError(
          socket,
          callback,
          "Only the host can change lobby settings."
        );
      }

      const rounds = Number(payload.rounds);
      const roundDuration = Number(payload.roundDuration);

      if (
        !Number.isInteger(rounds) ||
        rounds < 1 ||
        rounds > 8 ||
        !Number.isInteger(roundDuration) ||
        roundDuration < 30 ||
        roundDuration > 180
      ) {
        return sendError(
          socket,
          callback,
          "Rounds must be 1–8 and turn time 30–180 seconds."
        );
      }

      room.settings = {
        rounds,
        roundDuration,
      };

      emitState(room);

      sendOk(callback);
    });

    // ========================================================
    // START GAME
    // ========================================================

    socket.on(
      "game:start",
      (payloadOrCallback, maybeCallback) => {
        const callback = getCallback(
          payloadOrCallback,
          maybeCallback
        );

        const found = findPlayer(socket);

        if (!found) {
          return sendError(
            socket,
            callback,
            "Join a room first."
          );
        }

        const { room, player } = found;

        if (player.id !== room.hostId) {
          return sendError(
            socket,
            callback,
            "Only the host can start the game."
          );
        }

        if (room.phase !== "lobby") {
          return sendError(
            socket,
            callback,
            "A game is already in progress."
          );
        }

        const connectedPlayers = [
          ...room.players.values(),
        ].filter((member) => member.connected);

        if (connectedPlayers.length < MIN_PLAYERS) {
          return sendError(
            socket,
            callback,
            "At least two connected players are needed to play."
          );
        }

        if (
          connectedPlayers.some((member) => !member.ready)
        ) {
          return sendError(
            socket,
            callback,
            "Everyone needs to be ready before the game can start."
          );
        }

        startGame(room);

        sendOk(callback);
      }
    );

    // ========================================================
    // WORD SELECTION
    // ========================================================

    socket.on(
      "game:choose-word",
      (payload = {}, callback) => {
        const found = findPlayer(socket);

        if (!found) {
          return sendError(
            socket,
            callback,
            "Join a room first."
          );
        }

        const { room, player } = found;

        if (
          room.phase !== "choosing" ||
          room.drawerId !== player.id ||
          !room.wordChoices.includes(payload.word)
        ) {
          return sendError(
            socket,
            callback,
            "That word choice is not available."
          );
        }

        startDrawing(room, payload.word);

        sendOk(callback);
      }
    );

    // ========================================================
    // DRAWING EVENTS
    // ========================================================

    // Receive and broadcast drawing strokes
    socket.on("draw:stroke", (payload = {}) => {
      const found = findPlayer(socket);

      if (
        !found ||
        found.room.phase !== "drawing" ||
        found.room.drawerId !== found.player.id
      ) {
        return;
      }

      const { room } = found;

      const { points, color, size, tool } = payload;

      // Validate incoming stroke data
      if (
        !Array.isArray(points) ||
        points.length < 1 ||
        points.length > 100 ||
        !points.every(
          (point) =>
            Number.isFinite(point.x) &&
            Number.isFinite(point.y) &&
            point.x >= 0 &&
            point.x <= 1 &&
            point.y >= 0 &&
            point.y <= 1
        ) ||
        typeof color !== "string" ||
        !/^#[0-9a-f]{6}$/i.test(color) ||
        !Number.isFinite(size) ||
        size < 1 ||
        size > 40 ||
        !["pencil", "eraser"].includes(tool)
      ) {
        return;
      }

      // Limit drawing event frequency
      const now = Date.now();

      if (now - (found.player.lastStrokeAt ?? 0) < 12) {
        return;
      }

      found.player.lastStrokeAt = now;

      const stroke = {
        points,
        color: tool === "eraser" ? "#ffffff" : color,
        size,
        tool,
      };

      room.strokes.push(stroke);

      // Keep only the latest 500 strokes
      if (room.strokes.length > 500) {
        room.strokes.shift();
      }

      // Send stroke to everyone except the drawer
      socket.to(room.code).emit("draw:stroke", stroke);
    });

    // Undo last drawing stroke
    socket.on(
      "draw:undo",
      (payloadOrCallback, maybeCallback) => {
        const callback = getCallback(
          payloadOrCallback,
          maybeCallback
        );

        const found = findPlayer(socket);

        if (
          !found ||
          found.room.phase !== "drawing" ||
          found.room.drawerId !== found.player.id
        ) {
          return sendError(
            socket,
            callback,
            "Only the drawer can undo."
          );
        }

        const stroke = found.room.strokes.pop();

        if (stroke) {
          broadcast(found.room, "draw:undo", {
            count: 1,
          });
        }

        emitState(found.room);

        sendOk(callback);
      }
    );

    // Clear complete drawing canvas
    socket.on(
      "draw:clear",
      (payloadOrCallback, maybeCallback) => {
        const callback = getCallback(
          payloadOrCallback,
          maybeCallback
        );

        const found = findPlayer(socket);

        if (
          !found ||
          found.room.phase !== "drawing" ||
          found.room.drawerId !== found.player.id
        ) {
          return sendError(
            socket,
            callback,
            "Only the drawer can clear the canvas."
          );
        }

        found.room.strokes = [];

        broadcast(found.room, "draw:clear", {});

        emitState(found.room);

        sendOk(callback);
      }
    );

    // ========================================================
    // CHAT & WORD GUESSING
    // ========================================================

    socket.on("chat:send", (payload = {}, callback) => {
      const found = findPlayer(socket);

      if (!found) {
        return sendError(
          socket,
          callback,
          "Join a room first."
        );
      }

      const { room, player } = found;

      // Chat and guessing are available only during drawing
      if (
        room.phase !== "drawing" ||
        player.id === room.drawerId
      ) {
        return sendOk(callback);
      }

      const text =
        typeof payload.text === "string"
          ? payload.text.trim().slice(0, 200)
          : "";

      if (!text) {
        return sendOk(callback);
      }

      // Check whether the player guessed correctly
      const isCorrectGuess =
        room.phase === "drawing" &&
        room.word &&
        player.id !== room.drawerId &&
        !room.guessed.has(player.id) &&
        normalizeWord(text) === normalizeWord(room.word);

      if (isCorrectGuess) {
        room.guessed.add(player.id);

        const remaining = Math.max(
          0,
          room.endsAt - Date.now()
        );

        // Calculate guesser points
        const guessPoints = Math.max(
          50,
          Math.round(
            500 *
            remaining /
            (room.settings.roundDuration * 1000)
          )
        );

        // Calculate drawer points
        const drawer = room.players.get(room.drawerId);

        player.score += guessPoints;

        if (drawer) {
          drawer.score += Math.max(
            20,
            Math.round(
              100 *
              remaining /
              (room.settings.roundDuration * 1000)
            )
          );
        }

        // Broadcast correct guess message
        broadcast(room, "chat:message", {
          id: randomUUID(),
          playerId: player.id,
          username: player.username,
          text: `${player.username} guessed the word!`,
          kind: "correct",
          at: Date.now(),
        });

        // Notify clients about correct guess
        broadcast(room, "game:correct-guess", {
          playerId: player.id,
          username: player.username,
          points: guessPoints,
        });

        emitState(room);

        // Finish turn if everyone has guessed
        const guessers = [
          ...room.players.values(),
        ].filter(
          (candidate) => candidate.id !== room.drawerId
        );

        if (
          guessers.length &&
          guessers.every((candidate) =>
            room.guessed.has(candidate.id)
          )
        ) {
          finishTurn(room);
        }
      } else {
        // Players who already guessed cannot send more messages
        if (
          room.phase === "drawing" &&
          room.guessed.has(player.id)
        ) {
          return sendOk(callback);
        }

        // Broadcast normal chat message
        broadcast(room, "chat:message", {
          id: randomUUID(),
          playerId: player.id,
          username: player.username,
          text,
          kind: "chat",
          at: Date.now(),
        });
      }

      sendOk(callback);
    });

    // ========================================================
    // PLAY AGAIN
    // ========================================================

    socket.on(
      "game:play-again",
      (payloadOrCallback, maybeCallback) => {
        const callback = getCallback(
          payloadOrCallback,
          maybeCallback
        );

        const found = findPlayer(socket);

        if (!found) {
          return sendError(
            socket,
            callback,
            "Join a room first."
          );
        }

        const { room, player } = found;

        if (
          room.phase !== "gameOver" ||
          player.id !== room.hostId
        ) {
          return sendError(
            socket,
            callback,
            "Only the host can start another game."
          );
        }

        const connectedPlayers = [
          ...room.players.values(),
        ].filter((member) => member.connected);

        if (connectedPlayers.length < MIN_PLAYERS) {
          return sendError(
            socket,
            callback,
            "At least two connected players are needed to play again."
          );
        }

        for (const member of room.players.values()) {
          member.ready = true;
        }

        startGame(room);

        sendOk(callback);
      }
    );

    // ========================================================
    // RETURN TO LOBBY
    // ========================================================

    socket.on(
      "room:return-lobby",
      (payloadOrCallback, maybeCallback) => {
        const callback = getCallback(
          payloadOrCallback,
          maybeCallback
        );

        const found = findPlayer(socket);

        if (!found) {
          return sendError(
            socket,
            callback,
            "Join a room first."
          );
        }

        const { room, player } = found;

        if (
          room.phase !== "gameOver" ||
          player.id !== room.hostId
        ) {
          return sendError(
            socket,
            callback,
            "Only the host can return the room to the lobby."
          );
        }

        returnToLobby(room);

        sendOk(callback);
      }
    );

    // ========================================================
    // LEAVE ROOM
    // ========================================================

    socket.on(
      "room:leave",
      (payloadOrCallback, maybeCallback) => {
        const callback = getCallback(
          payloadOrCallback,
          maybeCallback
        );

        const found = findPlayer(socket);

        if (!found) {
          return sendOk(callback);
        }

        const { room, player } = found;

        socket.leave(room.code);

        socket.data.roomCode = null;
        socket.data.playerId = null;

        removePlayer(room, player.id);

        sendOk(callback);
      }
    );

    // ========================================================
    // DISCONNECT & RECONNECTION HANDLING
    // ========================================================

    socket.on("disconnect", () => {
      const found = findPlayer(socket);

      if (!found) return;

      const { room, player } = found;

      player.connected = false;
      player.socketId = null;

      // Transfer host ownership temporarily
      if (room.hostId === player.id) {
        room.hostId =
          [...room.players.values()].find(
            (candidate) => candidate.connected
          )?.id ?? player.id;

        broadcast(room, "room:host-changed", {
          hostId: room.hostId,
        });
      }

      emitState(room);

      // Remove player after reconnect grace period
      player.reconnectTimer = setTimeout(() => {
        if (
          rooms.get(room.code) === room &&
          !player.connected
        ) {
          removePlayer(room, player.id);
        }
      }, RECONNECT_GRACE_MS);

      // Delete room if every player disconnects
      const hasConnectedPlayers = [
        ...room.players.values(),
      ].some((candidate) => candidate.connected);

      if (!hasConnectedPlayers) {
        room.emptyTimer = setTimeout(() => {
          const stillEmpty = ![
            ...room.players.values(),
          ].some((candidate) => candidate.connected);

          if (stillEmpty) {
            clearTimer(room, "turnTimer");
            clearTimer(room, "choiceTimer");
            clearTimer(room, "pauseTimer");

            rooms.delete(room.code);
          }
        }, RECONNECT_GRACE_MS);
      }
    });

  });
}
