const SOUND_PATTERNS = {
  chat: [[660, 0.045]],
  correct: [[520, 0.08], [780, 0.14]],
  round: [[440, 0.08], [660, 0.12]],
  joined: [[560, 0.07]],
  countdown: [[420, 0.05]],
  gameOver: [[660, 0.1], [520, 0.12], [780, 0.2]],
};

let audioContext;

export function unlockGameAudio() {
  if (typeof window === "undefined") return;

  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) return;

  try {
    audioContext ??= new AudioContextClass();
    if (audioContext.state === "suspended") {
      audioContext.resume().catch((error) => {
        console.warn("Could not resume game audio:", error);
      });
    }
  } catch (error) {
    console.warn("Could not initialize game audio:", error);
  }
}

export function playGameSound(name, volume = 0.35) {
  if (typeof window === "undefined") return;

  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) return;

  const pattern = SOUND_PATTERNS[name];
  if (!pattern) return;
  if (volume <= 0) return;

  try {
    audioContext ??= new AudioContextClass();

    if (audioContext.state === "suspended") {
      audioContext.resume().catch((error) => {
        console.warn("Could not resume game audio:", error);
      });
    }

    let startAt = audioContext.currentTime;

    for (const [frequency, duration] of pattern) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const peak = Math.max(0.001, Math.min(1, volume) * 0.12);

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.001, startAt);
      gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.01);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        startAt + duration
      );

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration);
      startAt += duration + 0.025;
    }
  } catch (error) {
    console.warn("Could not play game sound:", error);
  }
}

export function vibrate(pattern) {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.vibrate !== "function"
  ) {
    return;
  }

  try {
    navigator.vibrate(pattern);
  } catch (error) {
    console.warn("Could not trigger haptic feedback:", error);
  }
}
