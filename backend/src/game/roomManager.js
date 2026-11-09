
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
const FIRST_HINT_DELAY_MS = 20_000;
const NEXT_HINT_DELAY_MS = 15_000;

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

// Build the stable hint shown to guessers.
function hintPattern(word, revealedIndices) {
  const chars = [...word];

  return chars
    .map((char, index) =>
      char === " " || revealedIndices.has(index)
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

  function clearGameTimers(room) {
    clearTimer(room, "choiceTimer");
    clearTimer(room, "turnTimer");
    clearTimer(room, "pauseTimer");
    resetHints(room);
  }

  function connectedPlayerCount(room) {
    return [...room.players.values()].filter(
      (player) => player.connected
    ).length;
  }

  // ==========================================================
  // ROOM STATE MANAGEMENT
  // ==========================================================

  // Send personalized room state to every connected player
  function emitState(room) {
    for (const player of room.players.values()) {
      if (!player.connected || !player.socketId) continue;

      const maskedWord =
        room.phase === "drawing" &&
        room.word &&
        room.drawerId !== player.id
          ? hintPattern(room.word, room.hintLetters)
          : "";

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

        maskedWord,
        hint: maskedWord,

        wordChoices:
          room.drawerId === player.id &&
          room.phase === "choosing"
            ? room.wordChoices
            : undefined,
      };

      io.to(player.socketId).emit("room:state", state);
    }
  }

  function resetHints(room) {
    clearTimer(room, "hintTimer");
    room.hintLetters = new Set();
    room.hintVersion += 1;
  }

  function scheduleHint(room, delay = FIRST_HINT_DELAY_MS) {
    clearTimer(room, "hintTimer");

    if (room.phase !== "drawing" || !room.word) return;

    const hintVersion = room.hintVersion;
    const word = room.word;

    room.hintTimer = setTimeout(() => {
      if (
        hintVersion !== room.hintVersion ||
        room.phase !== "drawing" ||
        room.word !== word
      ) {
        return;
      }

      room.hintTimer = null;

      const chars = [...word];
      const unrevealed = chars
        .map((char, index) => ({ char, index }))
        .filter(
          ({ char, index }) =>
            char !== " " && !room.hintLetters.has(index)
        );

      if (!unrevealed.length) return;

      const { char } =
        unrevealed[Math.floor(Math.random() * unrevealed.length)];

      chars.forEach((current, index) => {
        if (current === char) {
          room.hintLetters.add(index);
        }
      });

      emitState(room);
      scheduleHint(room, NEXT_HINT_DELAY_MS);
    }, delay);
  }

  // Broadcast an event to everyone in the room
  function broadcast(room, event, data) {
    io.to(room.code).emit(event, data);
  }

  function emitPrivateWord(room) {
    const drawer = room.players.get(room.drawerId);

    if (
      room.phase !== "drawing" ||
      !room.word ||
      !drawer?.connected ||
      !drawer.socketId
    ) {
      return;
    }

    io.to(drawer.socketId).emit("game:private-word", {
      drawerId: drawer.id,
      round: room.round,
      word: room.word,
    });
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

  function scheduleWordChoice(room) {
    clearTimer(room, "choiceTimer");

    const gameGeneration = room.gameGeneration;
    room.choiceTimer = setTimeout(() => {
      if (
        room.gameGeneration !== gameGeneration ||
        room.phase !== "choosing" ||
        !room.drawerId ||
        !room.wordChoices.length
      ) {
        return;
      }

      if (connectedPlayerCount(room) < MIN_PLAYERS) {
        room.waitingForPlayers = true;
        return;
      }

      if (room.players.get(room.drawerId)?.connected) {
        startDrawing(room, room.wordChoices[0]);
      } else {
        finishTurn(room);
      }
    }, 15_000);
  }

  // Select the next drawer
  function chooseDrawer(room) {
    if (
      (room.phase !== "choosing" &&
        room.phase !== "roundEnd") ||
      room.players.size < MIN_PLAYERS
    ) {
      return;
    }

    if (connectedPlayerCount(room) < MIN_PLAYERS) {
      room.waitingForPlayers = true;
      return;
    }

    room.phase = "choosing";

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
    resetHints(room);
    room.phase = "choosing";
    room.word = "";
    room.wordChoices = chooseWords();
    room.strokes = [];
    room.guessed = new Set();
    room.endsAt = null;

    emitState(room);

    scheduleWordChoice(room);
  }

  // Start the drawing phase
  function startDrawing(room, word) {
    if (
      room.phase !== "choosing" ||
      room.players.size < MIN_PLAYERS ||
      connectedPlayerCount(room) < MIN_PLAYERS ||
      !room.drawerId ||
      !room.players.get(room.drawerId)?.connected ||
      typeof word !== "string" ||
      !word
    ) {
      return finishTurn(room);
    }

    clearTimer(room, "choiceTimer");

    room.word = word;
    room.wordChoices = [];
    room.phase = "drawing";
    resetHints(room);
    scheduleHint(room);

    room.endsAt =
      Date.now() + room.settings.roundDuration * 1000;

    const gameGeneration = room.gameGeneration;
    room.turnTimer = setTimeout(() => {
      if (room.gameGeneration === gameGeneration) {
        finishTurn(room);
      }
    }, room.settings.roundDuration * 1000);

    broadcast(room, "round:started", {
      round: room.round,
      drawerId: room.drawerId,
    });

    emitState(room);
    emitPrivateWord(room);
  }

  // Finish the current player's turn
  function finishTurn(room) {
    if (
      room.phase !== "choosing" &&
      room.phase !== "drawing"
    ) {
      return;
    }

    clearTimer(room, "choiceTimer");
    clearTimer(room, "turnTimer");
    clearTimer(room, "pauseTimer");
    resetHints(room);

    room.phase = "roundEnd";
    room.endsAt = null;

    broadcast(room, "round:ended", {
      scores: [...room.players.values()].map(publicPlayer),
    });

    emitState(room);

    const gameGeneration = room.gameGeneration;
    room.pauseTimer = setTimeout(() => {
      if (
        room.gameGeneration !== gameGeneration ||
        room.phase !== "roundEnd"
      ) {
        return;
      }

      chooseDrawer(room);
    }, ROUND_PAUSE_MS);
  }

  // Finish the complete game
  function finishGame(room) {
    clearTimer(room, "choiceTimer");
    clearTimer(room, "turnTimer");
    clearTimer(room, "pauseTimer");
    resetHints(room);

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
    clearGameTimers(room);
    room.gameGeneration += 1;

    room.phase = "choosing";
    room.round = 1;

    room.drawerOrder = [...room.players.keys()];
    room.turnIndex = 0;
    room.waitingForPlayers = false;

    for (const player of room.players.values()) {
      player.score = 0;
    }

    chooseDrawer(room);
  }

  // Return room to lobby after game completion
  function returnToLobby(room) {
    clearGameTimers(room);
    room.gameGeneration += 1;

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

  function endGameForInsufficientPlayers(room) {
    if (
      room.phase !== "choosing" &&
      room.phase !== "drawing" &&
      room.phase !== "roundEnd"
    ) {
      return;
    }

    clearGameTimers(room);
    room.gameGeneration += 1;
    room.phase = "lobby";
    room.round = 0;
    room.drawerId = null;
    room.drawerOrder = [];
    room.turnIndex = 0;
    room.waitingForPlayers = false;
    room.word = "";
    room.wordChoices = [];
    room.strokes = [];
    room.guessed.clear();
    room.endsAt = null;

    for (const member of room.players.values()) {
      member.score = 0;
      member.ready = member.id === room.hostId;
    }

    broadcast(room, "game:ended", {
      reason: "Not enough players to continue",
    });

    emitState(room);
  }

  // ==========================================================
  // PLAYER MANAGEMENT
  // ==========================================================

  // Remove a player from a room
  function removePlayer(room, playerId) {
    const player = room.players.get(playerId);

    if (!player) return;

    clearTimeout(player.reconnectTimer);

    // Remove socket from room
    if (player.socketId) {
      const socket = io.sockets.sockets.get(
        player.socketId
      );

      socket?.leave(room.code);
    }

    room.players.delete(playerId);

    resetHints(room);
    if (room.phase === "drawing" && room.drawerId !== playerId) {
      scheduleHint(room);
    }

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

    if (!room.players.size) {
      clearGameTimers(room);
      room.gameGeneration += 1;
      clearTimer(room, "emptyTimer");
      rooms.delete(room.code);
      return;
    }

    if (
      room.players.size < MIN_PLAYERS &&
      (room.phase === "choosing" ||
        room.phase === "drawing" ||
        room.phase === "roundEnd")
    ) {
      endGameForInsufficientPlayers(room);
      return;
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
        hintLetters: new Set(),
        hintVersion: 0,
        gameGeneration: 0,
        waitingForPlayers: false,

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

      socket.to(code).emit("player:joined", {
        username: player.username,
      });

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
      clearTimer(room, "emptyTimer");

      const roomWasEmpty = ![...room.players.values()].some(
        (member) => member.connected
      );

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

      if (roomWasEmpty && room.phase === "drawing") {
        resetHints(room);
        scheduleHint(room);
      }

      if (
        room.waitingForPlayers &&
        connectedPlayerCount(room) >= MIN_PLAYERS
      ) {
        room.waitingForPlayers = false;

        if (room.phase === "choosing") {
          scheduleWordChoice(room);
        } else if (room.phase === "roundEnd") {
          clearTimer(room, "pauseTimer");
          const gameGeneration = room.gameGeneration;
          room.pauseTimer = setTimeout(() => {
            if (
              room.gameGeneration === gameGeneration &&
              room.phase === "roundEnd"
            ) {
              chooseDrawer(room);
            }
          }, ROUND_PAUSE_MS);
        }
      }

      emitState(room);
      emitPrivateWord(room);

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
          connectedPlayerCount(room) < MIN_PLAYERS ||
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
        connectedPlayerCount(found.room) < MIN_PLAYERS ||
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
          connectedPlayerCount(found.room) < MIN_PLAYERS ||
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
          connectedPlayerCount(found.room) < MIN_PLAYERS ||
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
        connectedPlayerCount(room) < MIN_PLAYERS ||
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

      const hasConnectedPlayers = [...room.players.values()].some(
        (candidate) => candidate.connected
      );

      if (
        connectedPlayerCount(room) < MIN_PLAYERS &&
        (room.phase === "choosing" ||
          room.phase === "drawing" ||
          room.phase === "roundEnd")
      ) {
        room.waitingForPlayers = true;
      }

      resetHints(room);
      if (hasConnectedPlayers && room.phase === "drawing") {
        scheduleHint(room);
      }

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
      if (!hasConnectedPlayers) {
        room.emptyTimer = setTimeout(() => {
          const stillEmpty = ![
            ...room.players.values(),
          ].some((candidate) => candidate.connected);

          if (stillEmpty) {
            clearGameTimers(room);
            room.gameGeneration += 1;
            clearTimer(room, "emptyTimer");
            for (const member of room.players.values()) {
              clearTimeout(member.reconnectTimer);
            }

            rooms.delete(room.code);
          }
        }, RECONNECT_GRACE_MS);
      }
    });

  });
}
