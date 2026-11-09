
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { io } from "socket.io-client";

import Lobby from "./components/Lobby.jsx";
import Game from "./components/Game.jsx";
import {
  playGameSound,
  unlockGameAudio,
  vibrate,
} from "./audioFeedback.js";

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

// Automatically detect backend IP from the current frontend URL.
//
// Laptop: http://localhost:5173 -> http://localhost:3001
// Phone:  http://192.168.1.5:5173 -> http://192.168.1.5:3001

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  `${window.location.protocol}//${window.location.hostname}:3001`;

const STORAGE_KEY = "doodlerush-session";

// --------------------------------------------------
// SESSION HELPERS
// --------------------------------------------------

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function readSoundSettings() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("doodlerush-sound-settings") || "null"
    );

    return {
      enabled: saved?.enabled !== false,
      volume:
        Number.isFinite(saved?.volume)
          ? Math.max(0, Math.min(1, saved.volume))
          : 0.35,
    };
  } catch {
    return { enabled: true, volume: 0.35 };
  }
}

// --------------------------------------------------
// CLIPBOARD HELPER
// --------------------------------------------------

async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");

  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  textArea.setAttribute("readonly", "");

  document.body.appendChild(textArea);

  textArea.select();
  textArea.setSelectionRange(0, text.length);

  const copied = document.execCommand("copy");

  document.body.removeChild(textArea);

  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}

// --------------------------------------------------
// MAIN APP
// --------------------------------------------------

export default function App() {
  // Socket reference
  const socketRef = useRef(null);
  const roomRef = useRef(null);
  const privateWordRef = useRef(null);
  const soundSettingsRef = useRef(null);

  // Application state
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState(null);
  const [privateWord, setPrivateWord] = useState(null);
  const [soundSettings, setSoundSettings] = useState(readSoundSettings);
  const [session, setSession] = useState(readSession);

  const [username, setUsername] = useState("");
  const [roomCode, setRoomCode] = useState("");

  const [error, setError] = useState("");
  const [messages, setMessages] = useState([]);
  const [notice, setNotice] = useState("");

  soundSettingsRef.current = soundSettings;

  const playSound = useCallback((name) => {
    const settings = soundSettingsRef.current;
    if (settings?.enabled) {
      playGameSound(name, settings.volume);
    }
  }, []);

  const updateSoundEnabled = useCallback((enabled) => {
    if (enabled) unlockGameAudio();
    setSoundSettings((current) => ({ ...current, enabled }));
  }, []);

  // --------------------------------------------------
  // SOCKET CONNECTION AND EVENT LISTENERS
  // --------------------------------------------------

  useEffect(() => {
    console.log("Connecting to game server:", SERVER_URL);

    const socket = io(SERVER_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    // Connection established
    const handleConnect = () => {
      console.log("Socket connected:", socket.id);

      setConnected(true);
      setError("");

      // Restore previous session if available
      const saved = readSession();

      if (saved?.code && saved?.reconnectToken) {
        socket.emit("room:resume", saved, (result) => {
          if (result?.ok) {
            setSession(saved);
          } else {
            localStorage.removeItem(STORAGE_KEY);

            setSession(null);
            roomRef.current = null;
            privateWordRef.current = null;
            setPrivateWord(null);
            setRoom(null);
          }
        });
      }
    };

    // Connection lost
    const handleDisconnect = (reason) => {
      console.warn("Socket disconnected:", reason);
      setConnected(false);
    };

    // Connection error
    const handleConnectError = (error) => {
      console.error("Socket connection error:", error.message);

      setConnected(false);
      setError("Unable to connect to the game server. Reconnecting...");
    };

    // Room state update
    const handleRoomState = (newRoom) => {
      const currentWord = privateWordRef.current;
      const currentTurnKey =
        newRoom.phase === "drawing" && newRoom.yourTurn
          ? `${newRoom.drawerId}:${newRoom.round}`
          : null;

      if (
        !currentTurnKey ||
        !currentWord ||
        currentWord.turnKey !== currentTurnKey
      ) {
        privateWordRef.current = null;
        setPrivateWord(null);
      }

      roomRef.current = newRoom;
      setRoom(newRoom);
    };

    const handlePrivateWord = ({ drawerId, round, word }) => {
      const currentRoom = roomRef.current;

      if (
        !currentRoom?.yourTurn ||
        currentRoom.phase !== "drawing" ||
        currentRoom.drawerId !== drawerId ||
        currentRoom.round !== round ||
        typeof word !== "string" ||
        !word
      ) {
        return;
      }

      const nextWord = {
        drawerId,
        round,
        turnKey: `${drawerId}:${round}`,
        word,
      };

      privateWordRef.current = nextWord;
      setPrivateWord(nextWord);
    };

    // Drawing events
    const handleDrawStroke = (stroke) => {
      setRoom((current) =>
        current
          ? {
              ...current,
              strokes: [...(current.strokes || []), stroke],
            }
          : current
      );
    };

    const handleDrawUndo = ({ count }) => {
      setRoom((current) => {
        if (!current || !count || count <= 0) {
          return current;
        }

        return {
          ...current,
          strokes: (current.strokes || []).slice(0, -count),
        };
      });
    };

    const handleDrawClear = () => {
      setRoom((current) =>
        current
          ? {
              ...current,
              strokes: [],
            }
          : current
      );
    };

    // Chat events
    const handleChatMessage = (message) => {
      if (
        message.kind === "chat" &&
        message.playerId !== roomRef.current?.playerId
      ) {
        playSound("chat");
      }

      setMessages((items) => [...items.slice(-99), message]);
    };

    // Game events
    const handleCorrectGuess = ({ username: name, points }) => {
      playSound("correct");
      vibrate(100);
      setNotice(`${name} guessed it! +${points} points`);
    };

    const handleRoundEnded = () => {
      setNotice("Round ended");
    };

    const handleRoundStarted = () => {
      playSound("round");
      vibrate(40);
    };

    const handlePlayerJoined = () => {
      playSound("joined");
      vibrate(30);
    };

    const handleGameOver = () => {
      playSound("gameOver");
      vibrate(250);
    };

    const handleGameEnded = ({ reason }) => {
      privateWordRef.current = null;
      setPrivateWord(null);
      setNotice("Game ended because not enough players remained.");
      const returnToLobby = (current) =>
        current
          ? {
              ...current,
              phase: "lobby",
              round: 0,
              drawerId: null,
              endsAt: null,
              wordChoices: undefined,
              maskedWord: "",
              hint: "",
              guessedIds: [],
              strokes: [],
            }
          : null;

      roomRef.current = returnToLobby(roomRef.current);
      setRoom(returnToLobby);

      if (reason !== "Not enough players to continue") {
        console.warn("Game ended:", reason);
      }
    };

    // Server errors
    const handleAppError = ({ error: message }) => {
      setError(message);
    };

    // Register socket listeners
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);

    socket.on("room:state", handleRoomState);
    socket.on("game:private-word", handlePrivateWord);

    socket.on("draw:stroke", handleDrawStroke);
    socket.on("draw:undo", handleDrawUndo);
    socket.on("draw:clear", handleDrawClear);

    socket.on("chat:message", handleChatMessage);

    socket.on("game:correct-guess", handleCorrectGuess);
    socket.on("round:started", handleRoundStarted);
    socket.on("round:ended", handleRoundEnded);
    socket.on("player:joined", handlePlayerJoined);
    socket.on("game:over", handleGameOver);
    socket.on("game:ended", handleGameEnded);

    socket.on("app:error", handleAppError);

    // Read room code from invitation URL
    const inviteCode = new URLSearchParams(
      window.location.search
    ).get("room");

    if (inviteCode) {
      setRoomCode(inviteCode.toUpperCase());
    }

    // Connect after registering listeners
    socket.connect();

    // Cleanup
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);

      socket.off("room:state", handleRoomState);
      socket.off("game:private-word", handlePrivateWord);

      socket.off("draw:stroke", handleDrawStroke);
      socket.off("draw:undo", handleDrawUndo);
      socket.off("draw:clear", handleDrawClear);

      socket.off("chat:message", handleChatMessage);

      socket.off("game:correct-guess", handleCorrectGuess);
      socket.off("round:started", handleRoundStarted);
      socket.off("round:ended", handleRoundEnded);
      socket.off("player:joined", handlePlayerJoined);
      socket.off("game:over", handleGameOver);
      socket.off("game:ended", handleGameEnded);

      socket.off("app:error", handleAppError);

      socket.disconnect();

      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        "doodlerush-sound-settings",
        JSON.stringify(soundSettings)
      );
    } catch (error) {
      console.warn("Could not save sound settings:", error);
    }
  }, [soundSettings]);

  // --------------------------------------------------
  // NOTICE AUTO DISMISS
  // --------------------------------------------------

  useEffect(() => {
    if (!notice) return;

    const timer = setTimeout(() => {
      setNotice("");
    }, 3200);

    return () => clearTimeout(timer);
  }, [notice]);

  // --------------------------------------------------
  // SAVE PLAYER SESSION
  // --------------------------------------------------

  const saveSession = useCallback((result) => {
    const next = {
      code: result.code,
      playerId: result.playerId,
      reconnectToken: result.reconnectToken,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));

    setSession(next);
    setError("");
    setMessages([]);
  }, []);

  // --------------------------------------------------
  // SOCKET ACTION HANDLER
  // --------------------------------------------------

  const perform = (event, payload) =>
    new Promise((resolve) => {
      const socket = socketRef.current;

      if (!socket?.connected) {
        setError("Connection lost. Reconnecting...");
        resolve({ ok: false });
        return;
      }

      // Drawing events do not require acknowledgement
      if (event === "draw:stroke") {
        socket.emit(event, payload);
        resolve({ ok: true });
        return;
      }

      // Other events use server acknowledgement
      socket.emit(event, payload, (result) => {
        if (!result?.ok) {
          setError(result?.error || "Something went wrong.");
        } else {
          setError("");
        }

        resolve(result || { ok: false });
      });
    });

  // --------------------------------------------------
  // ROOM ACTIONS
  // --------------------------------------------------

  const createRoom = async () => {
    if (!username.trim()) return;

    unlockGameAudio();

    const result = await perform("room:create", {
      username: username.trim(),
    });

    if (result.ok) {
      saveSession(result);
    }
  };

  const joinRoom = async () => {
    if (!username.trim() || roomCode.trim().length !== 6) {
      return;
    }

    unlockGameAudio();

    const result = await perform("room:join", {
      username: username.trim(),
      code: roomCode.trim().toUpperCase(),
    });

    if (result.ok) {
      saveSession(result);
    }
  };

  const leaveRoom = async () => {
    await perform("room:leave");

    localStorage.removeItem(STORAGE_KEY);

    setSession(null);
    roomRef.current = null;
    privateWordRef.current = null;
    setPrivateWord(null);
    setRoom(null);
    setMessages([]);
    setError("");
    setNotice("");
  };

  // --------------------------------------------------
  // COPY INVITE LINK
  // --------------------------------------------------

  const handleCopyInvite = async () => {
    if (!room?.code) return;

    const inviteUrl =
      `${window.location.origin}/?room=${room.code}`;

    try {
      await copyToClipboard(inviteUrl);
      setNotice("Invite link copied!");
    } catch (error) {
      console.error("Invite copy error:", error);

      setError(`Unable to copy. Copy manually: ${inviteUrl}`);
    }
  };

  // --------------------------------------------------
  // LANDING PAGE
  // --------------------------------------------------

  if (!session || !room) {
    return (
      <main className="landing">
        <header className="topbar">
          <a className="brand" href="/">
            🎨 DoodleRush
          </a>

          <span className="online">
            <i />
            {connected ? "Servers ready" : "Connecting..."}
          </span>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              THE QUICK-DRAW PARTY GAME
            </span>

            <h1>
              Draw fast.
              <br />
              <span>Guess faster.</span>
            </h1>

            <p>
              Grab your friends, pick up a virtual pencil, and see who
              can turn a few squiggles into a winning streak.
            </p>

            <div className="feature-pills">
              <span>✏️ Make a masterpiece</span>
              <span>⚡ Beat the clock</span>
              <span>🏆 Claim the crown</span>
            </div>

            <div className="doodle-art" aria-hidden="true">
              <span>☀️</span>
              <span>🌈</span>
              <span>✦</span>
              <span>✎</span>
              <span>♡</span>
            </div>
          </div>

          <div className="start-card">
            <div className="card-spark">✦</div>

            <h2>Ready, set, doodle!</h2>

            <p>Pick a name and jump into the fun.</p>

            <label htmlFor="username">
              YOUR PLAYER NAME
            </label>

            <input
              id="username"
              value={username}
              maxLength={18}
              placeholder="e.g. DoodleBug"
              onChange={(event) => setUsername(event.target.value)}
              onKeyDown={(event) =>
                event.key === "Enter" && createRoom()
              }
            />

            <button
              className="button primary full"
              disabled={!connected || !username.trim()}
              onClick={createRoom}
            >
              Create a room <span>→</span>
            </button>

            <div className="divider">
              <span>OR JOIN YOUR FRIENDS</span>
            </div>

            <div className="join-row">
              <input
                aria-label="Room code"
                value={roomCode}
                maxLength={6}
                placeholder="6-digit room code"
                onChange={(event) =>
                  setRoomCode(event.target.value.toUpperCase())
                }
                onKeyDown={(event) =>
                  event.key === "Enter" && joinRoom()
                }
              />

              <button
                className="button secondary"
                disabled={
                  !connected ||
                  !username.trim() ||
                  roomCode.trim().length !== 6
                }
                onClick={joinRoom}
              >
                Join
              </button>
            </div>

            {error && <div className="error">{error}</div>}

            <div className="room-footnote">
              <span>👥</span> 2–8 players · No sign-up needed
            </div>
          </div>
        </section>

        <footer className="landing-footer">
          MADE FOR FRIENDS, FUELED BY IMAGINATION <span>✦</span>
        </footer>
      </main>
    );
  }

  // --------------------------------------------------
  // GAME PAGE
  // --------------------------------------------------

  return (
    <main className="app-shell">
      <header className="topbar game-topbar">
        <a
          className="brand"
          href="#"
          onClick={(event) => event.preventDefault()}
        >
          🎨 DoodleRush
        </a>

        <div className="room-badge">
          ROOM <strong>{room.code}</strong>
        </div>

        <div className="header-actions">
          <button
            className="button small-button"
            onClick={handleCopyInvite}
          >
            🔗 <span>Invite</span>
          </button>

          <button
            className="button small-button leave-button"
            onClick={leaveRoom}
          >
            Leave
          </button>
        </div>
      </header>

      <div className="connection-bar">
        {connected ? "● Connected" : "◌ Reconnecting to room..."}
      </div>

      {error && (
        <div className="error app-error">
          {error}
          <button onClick={() => setError("")}>×</button>
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}

      {room.phase === "lobby" ? (
        <Lobby
          room={room}
          onAction={perform}
          onError={setError}
          soundEnabled={soundSettings.enabled}
          volume={soundSettings.volume}
          onSoundEnabledChange={updateSoundEnabled}
          onVolumeChange={(volume) =>
            setSoundSettings((current) => ({ ...current, volume }))
          }
        />
      ) : (
        <Game
          room={room}
          messages={messages}
          onAction={perform}
          onError={setError}
          soundEnabled={soundSettings.enabled}
          volume={soundSettings.volume}
          onSoundEnabledChange={updateSoundEnabled}
          onVolumeChange={(volume) =>
            setSoundSettings((current) => ({ ...current, volume }))
          }
          onPlaySound={playSound}
          privateWord={privateWord}
        />
      )}
    </main>
  );
}
