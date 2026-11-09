
import React, { useEffect, useRef, useState } from "react";
import DrawingCanvas from "./DrawingCanvas.jsx";

// Format seconds into MM:SS
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = String(seconds % 60).padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

export default function Game({
  room,
  messages,
  onAction,
  onError,
  soundEnabled,
  volume,
  onSoundEnabledChange,
  onVolumeChange,
  onPlaySound,
  privateWord,
}) {
  // -------------------- STATE --------------------

  const [guess, setGuess] = useState("");
  const [seconds, setSeconds] = useState(0);

  const messageEndRef = useRef(null);

  // -------------------- PLAYER INFORMATION --------------------

  const drawer = room.drawerId === room.playerId;

  const me = room.players.find(
    (player) => player.id === room.playerId
  );

  const currentDrawer = room.players.find(
    (player) => player.id === room.drawerId
  );

  const sortedPlayers = [...room.players].sort(
    (a, b) => b.score - a.score
  );

  const winner = sortedPlayers[0];

  const enoughConnectedPlayers =
    room.players.filter((player) => player.connected).length >= 2;

  const hasGuessed = room.guessedIds?.includes(room.playerId);
  const ownWord =
    privateWord?.drawerId === room.drawerId &&
    privateWord.round === room.round
      ? privateWord.word
      : "";

  // -------------------- TIMER --------------------

  useEffect(() => {
    let previousRemaining = room.endsAt
      ? Math.max(
          0,
          Math.ceil((room.endsAt - Date.now()) / 1000)
        )
      : 0;

    const updateTimer = () => {
      const remaining = room.endsAt
        ? Math.max(
            0,
            Math.ceil((room.endsAt - Date.now()) / 1000)
          )
        : 0;

      if (
        room.phase === "drawing" &&
        remaining > 0 &&
        remaining < previousRemaining &&
        remaining <= 5
      ) {
        onPlaySound("countdown");
      }

      previousRemaining = remaining;
      setSeconds(remaining);
    };

    updateTimer();

    const timer = setInterval(updateTimer, 250);

    return () => clearInterval(timer);
  }, [room.endsAt, room.phase, onPlaySound]);

  // -------------------- AUTO-SCROLL CHAT --------------------

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  // -------------------- CHAT FUNCTIONALITY --------------------

  const sendMessage = async (event) => {
    event.preventDefault();

    const value = guess.trim();

    if (!value) return;

    const result = await onAction("chat:send", {
      text: value,
    });

    if (result.ok) {
      setGuess("");
    } else {
      onError(result.error);
    }
  };

  // -------------------- WORD SELECTION --------------------

  const chooseWord = async (word) => {
    const result = await onAction("game:choose-word", {
      word,
    });

    if (!result.ok) {
      onError(result.error);
    }
  };

  // -------------------- PLAY AGAIN --------------------

  const playAgain = async () => {
    const result = await onAction("game:play-again");

    if (!result.ok) {
      onError(result.error);
    }
  };

  // -------------------- RETURN TO LOBBY --------------------

  const returnToLobby = async () => {
    const result = await onAction("room:return-lobby");

    if (!result.ok) {
      onError(result.error);
    }
  };

  // -------------------- CHAT INPUT PLACEHOLDER --------------------

  const chatPlaceholder = drawer
    ? "Chat with players..."
    : hasGuessed
      ? "You guessed it!"
      : "Type your guess...";

  // -------------------- RENDER --------------------

  return (
    <section className="game-layout">

      {/* ==================== MAIN GAME AREA ==================== */}

      <div className="game-main">

        {/* Game Status Header */}

        <div className="game-status">

          <div className="turn-info">
            <span className="round-label">
              ROUND {room.round}
              <span> / {room.totalRounds}</span>
            </span>

            <strong>
              {room.phase !== "gameOver" && !enoughConnectedPlayers
                ? "Waiting for a player to reconnect..."
                : room.phase === "choosing"
                ? drawer
                  ? "Pick a word to draw"
                  : "Drawer is choosing a word..."

                : room.phase === "roundEnd"
                  ? "Round over"

                  : room.phase === "gameOver"
                    ? "Game complete!"

                    : drawer
                      ? "Your turn to draw!"
                      : `${currentDrawer?.username || "Drawer"} is drawing`}
            </strong>
          </div>

          {/* Countdown Timer */}

          <div
            className={`timer ${
              seconds < 15 ? "timer-low" : ""
            }`}
          >
            ⏱ <strong>{formatTime(seconds)}</strong>
          </div>

          {/* Secret Word / Hint */}

          {drawer && room.phase === "drawing" && (
            <div className="word-chip own-word-chip">
              YOUR WORD:{" "}
              <strong>
                {ownWord
                  ? [...ownWord].join(" ").toLocaleUpperCase()
                  : "Loading..."}
              </strong>
            </div>
          )}

          {!drawer && room.phase === "drawing" && (
            <div className="word-chip">
              GUESS THE WORD:{" "}
              <strong>{room.maskedWord || room.hint || "..."}</strong>
            </div>
          )}

        </div>

        {/* ==================== WORD PICKER ==================== */}

        {room.phase === "choosing" && drawer && (
          <div className="word-picker">

            <span>Choose your secret word</span>

            {(room.wordChoices || []).map((word) => (
              <button
                key={word}
                onClick={() => chooseWord(word)}
              >
                {word}
              </button>
            ))}

          </div>
        )}

        {/* ==================== DRAWING CANVAS ==================== */}

        <DrawingCanvas
          strokes={room.strokes || []}
          onAction={onAction}
          disabled={
            !drawer ||
            room.phase !== "drawing" ||
            !enoughConnectedPlayers
          }
        />

        {/* ==================== GAME OVER ==================== */}

        {room.phase === "gameOver" && (
          <div className="game-over-card">

            <span className="eyebrow">
              THAT'S A WRAP
            </span>

            <h2>
              🏆 {winner?.username || "No winner"} wins!
            </h2>

            <p>
              Want another round? Head back to the lobby.
            </p>

            {/* Host Controls */}

            {room.playerId === room.hostId && (
              <>
                <button
                  className="button primary"
                  onClick={playAgain}
                >
                  Play again →
                </button>

                <button
                  className="button lobby-return-button"
                  onClick={returnToLobby}
                >
                  Return to lobby
                </button>
              </>
            )}

          </div>
        )}

        {/* ==================== ROUND END ==================== */}

        {room.phase === "roundEnd" && (
          <div className="round-end-banner">
            Round complete. Next turn coming up!
          </div>
        )}

      </div>

      {/* ==================== GAME SIDEBAR ==================== */}

      <aside className="game-sidebar">

        {/* ==================== SCOREBOARD ==================== */}

        <div className="scoreboard">

          <div className="side-heading">

            <div>
              <span className="eyebrow">
                LIVE SCORES
              </span>

              <h2>
                Players <span>{room.players.length}</span>
              </h2>
            </div>

            <span>🏆</span>

          </div>

          {/* Sorted Player Scores */}

          {sortedPlayers.map((player, index) => {
            const isMe = player.id === room.playerId;
            const isCurrentDrawer = player.id === room.drawerId;

            return (
              <div
                className={`score-row ${
                  isMe ? "score-me" : ""
                }`}
                key={player.id}
              >

                <span className="score-rank">
                  {index === 0 && player.score > 0
                    ? "👑"
                    : index + 1}
                </span>

                <span className="score-name">
                  {player.username}
                  {isMe ? " (you)" : ""}
                  {isCurrentDrawer && room.phase !== "lobby"
                    ? " ✏️"
                    : ""}
                </span>

                <strong>{player.score}</strong>

              </div>
            );
          })}

        </div>

        {/* ==================== CHAT PANEL ==================== */}

        <div className="chat-panel">

          {/* Chat Header */}

          <div className="chat-heading">
            <h2>💬 Guesses & chat</h2>
            <span>LIVE</span>
          </div>

          <div className="sound-controls">
            <button
              className="sound-toggle"
              type="button"
              aria-pressed={soundEnabled}
              onClick={() => onSoundEnabledChange(!soundEnabled)}
            >
              Sound {soundEnabled ? "ON" : "OFF"}
            </button>

            <label>
              Volume
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                aria-label="Sound volume"
                disabled={!soundEnabled}
                onChange={(event) =>
                  onVolumeChange(Number(event.target.value))
                }
              />
            </label>
          </div>

          {/* Chat Messages */}

          <div className="chat-messages">

            <div className="chat-note">
              Be quick — the faster you guess, the more points you score!
            </div>

            {messages.map((message) => (
              <div
                className={`chat-message ${
                  message.kind === "correct"
                    ? "correct-message"
                    : ""
                }`}
                key={message.id}
              >

                <strong>{message.username}</strong>

                <span>{message.text}</span>

              </div>
            ))}

            {/* Auto-scroll Reference */}

            <div ref={messageEndRef} />

          </div>

          {/* Chat Input Form */}

          <form
            className="guess-form"
            onSubmit={sendMessage}
          >

            <input
              aria-label="Type your guess"
              placeholder={chatPlaceholder}
              value={guess}
              onChange={(event) => setGuess(event.target.value)}
              disabled={
                drawer ||
                hasGuessed ||
                room.phase !== "drawing" ||
                !enoughConnectedPlayers
              }
              maxLength={200}
            />

            <button
              aria-label="Send message"
              disabled={
                !guess.trim() ||
                drawer ||
                hasGuessed ||
                room.phase !== "drawing" ||
                !enoughConnectedPlayers
              }
            >
              ➤
            </button>

          </form>

        </div>

      </aside>

    </section>
  );
}
