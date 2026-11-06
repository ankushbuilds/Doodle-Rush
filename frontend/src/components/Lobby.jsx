
import React from "react";

export default function Lobby({
  room,
  onAction,
  onError,
  soundEnabled,
  volume,
  onSoundEnabledChange,
  onVolumeChange,
}) {
  const isHost = room.playerId === room.hostId;

  // Generate invite link using the current network URL
  const inviteUrl = `${window.location.origin}/?room=${room.code}`;

  // Update room settings (host only)
  const updateSettings = async (event) => {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    const result = await onAction("room:settings", {
      rounds: Number(form.get("rounds")),
      roundDuration: Number(form.get("roundDuration")),
    });

    if (!result.ok) {
      onError(result.error);
    }
  };

  // Copy invite link with fallback for HTTP network URLs
  const copyInviteLink = async () => {
    try {
      // Modern Clipboard API (HTTPS / localhost)
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(inviteUrl);
      } else {
        // Fallback for HTTP network URLs
        const textArea = document.createElement("textarea");

        textArea.value = inviteUrl;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        textArea.setAttribute("readonly", "");

        document.body.appendChild(textArea);

        textArea.select();
        textArea.setSelectionRange(0, textArea.value.length);

        const copied = document.execCommand("copy");

        document.body.removeChild(textArea);

        if (!copied) {
          throw new Error("Clipboard copy failed");
        }
      }

      onError("Invite link copied!");
    } catch (error) {
      console.error("Invite link copy error:", error);

      // Last fallback: show the link so the user can copy manually
      onError(`Unable to copy invite link. Copy manually: ${inviteUrl}`);
    }
  };

  // Start game
  const startGame = async () => {
    const result = await onAction("game:start");

    if (!result.ok) {
      onError(result.error);
    }
  };

  // Toggle player ready status
  const toggleReady = (player) => {
    onAction("player:ready", {
      ready: !player.ready,
    });
  };

  return (
    <section className="lobby-layout">
      {/* LEFT SECTION: Players and Invite */}

      <div className="lobby-main">
        {/* Lobby Header */}

        <div className="lobby-title">
          <span className="eyebrow">ROOM {room.code}</span>

          <h1>
            Your crew is here
            <span className="title-dot">.</span>
          </h1>

          <p>Share the code, then get ready to draw!</p>
        </div>

        {/* Players Grid */}

        <div className="players-grid">
          {room.players.map((player, index) => {
            const isCurrentPlayer = player.id === room.playerId;
            const isPlayerHost = player.id === room.hostId;

            const avatarEmojis = [
              "🐸",
              "🦊",
              "🐻",
              "🐼",
              "🐯",
              "🐵",
              "🐙",
              "🦄",
            ];

            const avatar = avatarEmojis[index % avatarEmojis.length];

            let playerStatus = "In the room";

            if (isPlayerHost) {
              playerStatus = "👑 Host";
            } else if (!player.connected) {
              playerStatus = "Reconnecting…";
            } else if (player.ready) {
              playerStatus = "✓ Ready";
            }

            return (
              <article
                className={`player-card ${
                  isPlayerHost ? "host-card" : ""
                }`}
                key={player.id}
              >
                {/* Player Avatar */}

                <div className={`avatar avatar-${index % 6}`}>
                  {avatar}
                </div>

                {/* Player Information */}

                <div className="player-info">
                  <strong>
                    {player.username}
                    {isCurrentPlayer ? " (you)" : ""}
                  </strong>

                  <span>{playerStatus}</span>
                </div>

                {/* Ready Button */}

                {isCurrentPlayer && !isPlayerHost ? (
                  <button
                    className={`ready-toggle ${
                      player.ready ? "ready-on" : ""
                    }`}
                    onClick={() => toggleReady(player)}
                  >
                    {player.ready ? "Ready ✓" : "Ready?"}
                  </button>
                ) : (
                  player.ready && (
                    <span className="ready-check">✓</span>
                  )
                )}
              </article>
            );
          })}

          {/* Empty Player Slots */}

          {Array.from(
            {
              length: Math.max(0, 2 - room.players.length),
            },
            (_, index) => (
              <div className="empty-seat" key={`empty-${index}`}>
                <span>＋</span>
                <small>Waiting for a friend</small>
              </div>
            )
          )}
        </div>

        {/* Invite Friends Panel */}

        <div className="invite-panel">
          <div className="invite-icon">🔗</div>

          <div>
            <strong>Bring your favorite people</strong>

            <span>
              Share this room code or send the invite link.
            </span>
          </div>

          <button
            className="button secondary"
            onClick={copyInviteLink}
          >
            Copy invite link
          </button>
        </div>
      </div>

      {/* RIGHT SECTION: Room Settings */}

      <aside className="lobby-side">
        {/* Settings Header */}

        <div className="side-heading">
          <div>
            <span className="eyebrow">GAME SETUP</span>
            <h2>Room settings</h2>
          </div>

          <span className="settings-icon">⚙️</span>
        </div>

        {/* Host Settings */}

        {isHost ? (
          <form onSubmit={updateSettings}>
            {/* Number of Rounds */}

            <label htmlFor="rounds">
              NUMBER OF ROUNDS
            </label>

            <select
              id="rounds"
              name="rounds"
              defaultValue={room.settings.rounds}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((number) => (
                <option key={number} value={number}>
                  {number} rounds
                </option>
              ))}
            </select>

            {/* Drawing Duration */}

            <label htmlFor="roundDuration">
              DRAWING TIME
            </label>

            <select
              id="roundDuration"
              name="roundDuration"
              defaultValue={room.settings.roundDuration}
            >
              {[30, 45, 60, 80, 100, 120, 150, 180].map(
                (duration) => (
                  <option key={duration} value={duration}>
                    {duration} seconds
                  </option>
                )
              )}
            </select>

            {/* Save Settings */}

            <button
              className="button text-button"
              type="submit"
            >
              Save settings
            </button>
          </form>
        ) : (
          /* Read-only Settings for Other Players */

          <div className="settings-readonly">
            <p>{room.settings.rounds} rounds</p>

            <p>
              {room.settings.roundDuration} seconds per turn
            </p>

            <span>
              Only the host can change settings.
            </span>
          </div>
        )}

        {/* How to Play */}

        <div className="lobby-tip">
          <span>💡</span>

          <p>
            <strong>How to play</strong>
            <br />
            Take turns drawing a secret word while everyone
            races to guess it in the chat.
          </p>
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

        {/* Start Game */}

        <button
          className="button primary full start-button"
          disabled={!isHost || room.players.length < 2}
          onClick={startGame}
        >
          {isHost ? "Start the game  →" : "Waiting for host…"}
        </button>

        {/* Start Game Conditions */}

        {room.players.length < 2 && (
          <small className="start-hint">
            You need at least one more player to start.
          </small>
        )}

        {room.players.length >= 2 &&
          room.players.some((player) => !player.ready) && (
            <small className="start-hint">
              Everyone must be ready before you can start.
            </small>
          )}
      </aside>
    </section>
  );
}
