import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

// THE SOUND OF DICTATION STARTING AND STOPPING (2026-11-20, the user's: «якщо ти починаєш голосовий ввід, треба нормальний
// красивий звучок»): two soft bell notes rising to say «слухаю», two falling to say «закінчив». Made in code
// (assets/sounds, sine + a quiet octave, a soft attack so nothing clicks), so there is no licence and no squeak.
//
// The start tone is played BEFORE the recogniser opens the microphone and the caller waits for it (the returned promise
// resolves when it is over), or the microphone would hear the tone and write it into the text.
let start: AudioPlayer | null = null;
let stop: AudioPlayer | null = null;
let modeSet = false;

async function ensureMode(): Promise<void> {
  if (modeSet) return;
  modeSet = true;
  // Mixed with whatever plays (a voiced note, music) rather than stopping it for a half-second chime.
  await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
}

function play(player: AudioPlayer): void {
  try {
    player.volume = 0.8;
    player.seekTo(0).catch(() => {});
    player.play();
  } catch {
    // A sound is a courtesy: never a reason the microphone does not open.
  }
}

export async function playDictationStart(): Promise<void> {
  try {
    await ensureMode();
    if (!start) start = createAudioPlayer(require('../../assets/sounds/dictation-start.wav'));
    play(start);
  } catch {
    return;
  }
  // The tone is about half a second long; the microphone waits for the end of it.
  await new Promise((resolve) => setTimeout(resolve, 520));
}

export function playDictationStop(): void {
  ensureMode()
    .then(() => {
      if (!stop) stop = createAudioPlayer(require('../../assets/sounds/dictation-stop.wav'));
      play(stop);
    })
    .catch(() => {});
}
