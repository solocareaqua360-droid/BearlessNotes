import * as voiceStore from './voiceStore';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { getGeminiKey } from './geminiKey';
import { hash } from './thoughtAI';
import { recordGemini } from './geminiUsage';

// READING A THOUGHT ALOUD (2026-10-15). The living voice is Gemini's own TTS (the user picked «Gemini 3.1 Flash TTS»
// by ear); each piece is voiced ONCE and kept as a file on the phone, so a second listening costs nothing and needs
// no network. With no key, no network or a busy service, the phone's own voice reads it at once (expo-speech) - a
// thought is never left unheard because a server did not answer.
//
// One queue for the whole app: «Прослухати всі» reads the cards one after another; a new request stops the old.

const TTS_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
// THE NEWER MODEL (2026-10-15): Gemini 3.8 Flash TTS, where the user found «Nika» by ear in AI Studio - Google lists
// 3.1 as legacy, and 3.8 costs less than half ($9 vs $20 per 1M audio tokens through 2026). Its voices are its own;
// the request is the same, the text sent under «## Transcript:» (AI Studio's own code), so nothing but the text is
// read aloud.
const TTS_38 = 'gemini-3.8-flash-tts';
// THE VOICE, chosen in Settings (2026-10-15, the user: «пункт в налаштуваннях зі зміною голосу»). Kept on this device.
// `model`: a voice of 3.8 is asked of 3.8 alone; the rest of 3.1 (2.5 when 3.1 is down).
// `style`: 3.8's short delivery note, as AI Studio's style menu sets it.
export const VOICES: { id: string; label: string; note: string; model?: string; style?: string }[] = [
  { id: 'Nika', label: 'Nika', note: 'тепла, приязна · новіша модель 3.8', model: TTS_38, style: 'friendly' },
  { id: 'Kore', label: 'Kore', note: 'спокійний, жіночий' },
  { id: 'Sulafat', label: 'Sulafat', note: 'теплий, жіночий' },
  { id: 'Aoede', label: 'Aoede', note: 'легкий, жіночий' },
  { id: 'Leda', label: 'Leda', note: 'молодий, жіночий' },
  { id: 'Achernar', label: 'Achernar', note: "м'який, жіночий" },
  { id: 'Charon', label: 'Charon', note: 'низький, чоловічий' },
  { id: 'Orus', label: 'Orus', note: 'твердий, чоловічий' },
  { id: 'Puck', label: 'Puck', note: 'жвавий, чоловічий' },
  { id: 'Fenrir', label: 'Fenrir', note: 'енергійний, чоловічий' },
  { id: 'Iapetus', label: 'Iapetus', note: 'ясний, чоловічий' },
];
const VOICE_KEY = 'thoughts.voiceName';
let voiceName: string | null = null;
export async function getVoiceName(): Promise<string> {
  if (voiceName) return voiceName;
  voiceName = (await AsyncStorage.getItem(VOICE_KEY).catch(() => null)) || 'Nika';
  return voiceName;
}
export async function setVoiceName(name: string) {
  voiceName = name;
  await AsyncStorage.setItem(VOICE_KEY, name).catch(() => {});
}
const PREVIEW = 'Привіт. Ось так я читатиму твої думки - спокійно і уважно.';
// A short sample in a voice, voiced once and kept like any other.
export async function previewVoice(name: string) {
  await stopVoice();
  const mine = run;
  const key = await getGeminiKey();
  emit({ ...IDLE, playing: true, title: `Голос ${name}`, index: 1, total: 1, pieceText: PREVIEW });
  const uri = key ? await geminiVoice(PREVIEW, key, name).catch(() => null) : null;
  if (mine !== run) return;
  if (uri) {
    emit({ source: 'gemini' });
    await playFile(uri, mine, PREVIEW, `Голос ${name}`);
  } else {
    emit({ source: 'phone' });
    await speakPhone(PREVIEW, mine);
  }
  if (mine === run) emit(IDLE);
}
// Pieces after the first stay short enough to be voiced well before the one in front ends (Gemini takes ~13 s for
// 400 characters; a 1948-character piece left half a minute of silence between pieces, 2026-10-15).
const CHUNK = 700;

// WHAT THE PLAYER SHOWS (the island by the camera, the card's own player, the shade): which card, where in it, the
// sentence being said now (estimated from the time within the piece - a sentence's share of the characters).
export type VoiceState = {
  playing: boolean; // a session is on (playing or paused)
  paused: boolean;
  title: string;
  thoughtId?: string;
  index: number; // card, 1-based
  total: number;
  source: 'gemini' | 'phone' | null;
  position: number; // seconds within the current piece
  duration: number;
  sentence: string; // the sentence being said now
  pieceText: string;
};
const IDLE: VoiceState = { playing: false, paused: false, title: '', index: 0, total: 0, source: null, position: 0, duration: 0, sentence: '', pieceText: '' };
let state: VoiceState = IDLE;
const listeners = new Set<(s: VoiceState) => void>();
const emit = (next: Partial<VoiceState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l(state));
};
export function subscribeVoice(l: (s: VoiceState) => void) {
  listeners.add(l);
  l(state);
  return () => {
    listeners.delete(l);
  };
}
export const voiceState = () => state;

let player: AudioPlayer | null = null;
let run = 0;
// Ends the piece now playing (a skip, a stop): its promise resolves and the loop reads what to do next.
let endPiece: (() => void) | null = null;
// A card to jump to, set by «наступна / попередня».
let jumpToItem: number | null = null;
// ONE LISTENING, ONE TIMELINE (2026-10-15, the user: «потрібно загальний час показувати ... відрізки будуть під
// капотом»). The pieces Gemini voices are an inner detail: the time shown runs over the whole listening, ±15 s steps
// across a piece's edge, and the next piece's player is made ready before the one in front ends, so it follows with
// no gap.
let jumpPiece: { k: number; at: number } | null = null;
let session: { k: number; count: number; lengths: Map<number, number> } | null = null;
let nextPlayer: { uri: string; p: AudioPlayer } | null = null;
function dropNextPlayer() {
  try {
    nextPlayer?.p.remove();
  } catch {
    // gone
  }
  nextPlayer = null;
}

function dropPlayer() {
  try {
    player?.clearLockScreenControls?.();
  } catch {
    // not on this platform
  }
  try {
    player?.pause();
    player?.remove();
  } catch {
    // already gone
  }
  player = null;
}

export async function stopVoice() {
  clearPauseTimer();
  dropNextPlayer();
  jumpPiece = null;
  session = null;
  run += 1;
  jumpToItem = null;
  dropPlayer();
  endPiece?.();
  endPiece = null;
  await Speech.stop().catch(() => {});
  emit(IDLE);
}

// A paused player is let go after a while (2026-10-15, the user: «плеєр залишається після виходу з додатку ... в
// шторці телефона»): Android keeps a media card for a paused session, and this one cannot be swiped away (the
// playback runs as a foreground service). Paused this long, it is a listening that has ended - stop it, and the card
// goes from the shade with it.
const PAUSE_RELEASE_MS = 5 * 60 * 1000;
let pauseTimer: ReturnType<typeof setTimeout> | null = null;
function clearPauseTimer() {
  if (pauseTimer) clearTimeout(pauseTimer);
  pauseTimer = null;
}

function armPauseTimer() {
  clearPauseTimer();
  pauseTimer = setTimeout(() => {
    pauseTimer = null;
    if (state.playing && state.paused) stopVoice();
  }, PAUSE_RELEASE_MS);
}

export function pauseVoice() {
  armPauseTimer();
  if (player) {
    player.pause();
    emit({ paused: true });
  } else {
    // The phone's voice cannot pause on Android: it stops, and «play» starts the card again.
    Speech.stop().catch(() => {});
    emit({ paused: true });
  }
}
export function resumeVoice() {
  clearPauseTimer();
  if (player) {
    player.play();
    emit({ paused: false });
  } else if (state.paused) {
    jumpToItem = state.index - 1;
    endPiece?.();
  }
}
export function seekVoice(delta: number) {
  if (!player) return;
  const cur = (player.currentTime || 0) + delta;
  const d = player.duration || 0;
  // Over a piece's edge: into the one before or after, where its length is known (it has been voiced).
  if (session && cur < 0 && session.k > 0) {
    const prev = session.lengths.get(session.k - 1);
    if (prev !== undefined) {
      jumpPiece = { k: session.k - 1, at: Math.max(0, prev + cur) };
      endPiece?.();
      return;
    }
  }
  if (session && d > 0 && cur > d - 0.2 && session.k < session.count - 1) {
    const next = session.lengths.get(session.k + 1);
    if (next !== undefined) {
      jumpPiece = { k: session.k + 1, at: Math.min(Math.max(0, cur - d), Math.max(0, next - 0.5)) };
      endPiece?.();
      return;
    }
  }
  const to = Math.max(0, Math.min(d - 0.2, cur));
  player.seekTo(to).catch?.(() => {});
}
// «Наступна / попередня картка».
export function skipVoice(delta: number) {
  if (!state.playing) return;
  const target = Math.max(0, Math.min(state.total - 1, state.index - 1 + delta));
  jumpToItem = target;
  dropPlayer();
  Speech.stop().catch(() => {});
  endPiece?.();
}

const sentencesOf = (text: string) => text.split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
function sentenceAt(text: string, share: number) {
  const list = sentencesOf(text);
  const at = Math.floor(Math.max(0, Math.min(1, share)) * text.length);
  let acc = 0;
  for (const sentence of list) {
    acc += sentence.length + 1;
    if (acc >= at) return sentence;
  }
  return list[list.length - 1] ?? '';
}

// Pieces cut at paragraph or sentence ends. The FIRST is short (a sentence or two), so the voice starts within a few
// seconds; the rest are voiced while the first plays (2026-10-15: the whole text was voiced before a sound, ~15 s of
// «готую голос…», and the user stopped it believing it broken).
const FIRST = 220;
// The pieces grow - 220, 400, then CHUNK - so each is voiced before the one in front has finished playing: a short
// first piece followed straight by a long one left ~8 s of silence between them (2026-10-15), the long one still
// being made.
const RAMP = [FIRST, 400];
function chunks(text: string): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest) {
    const size = RAMP[out.length] ?? CHUNK;
    if (rest.length <= size * 1.3) {
      out.push(rest);
      break;
    }
    const slice = rest.slice(0, size);
    const cut = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '), slice.lastIndexOf('… '));
    const at = cut > size * 0.4 ? cut + 1 : (() => {
      // No sentence end in reach: cut at the last space rather than mid-word.
      const space = slice.lastIndexOf(' ');
      return space > size * 0.4 ? space : size;
    })();
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  return out.filter(Boolean);
}

// --- a WAV around Gemini's raw PCM, without decoding the PCM -----------------------------------------------------
// The header is 54 bytes - a multiple of 3 - so its base64 can be put straight in front of the PCM's base64 (a JUNK
// chunk of 2 bytes pads the usual 44; players skip chunks they do not know).
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64(bytes: number[]) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return s;
}
function pcmBytes(base64: string) {
  const pad = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - pad;
}
function wavHeader(dataLen: number, rate: number) {
  const h: number[] = [];
  const str = (s: string) => s.split('').forEach((c) => h.push(c.charCodeAt(0)));
  const u32 = (v: number) => h.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  const u16 = (v: number) => h.push(v & 255, (v >> 8) & 255);
  str('RIFF');
  u32(46 + dataLen);
  str('WAVE');
  str('fmt ');
  u32(16);
  u16(1); // PCM
  u16(1); // mono
  u32(rate);
  u32(rate * 2);
  u16(2);
  u16(16);
  str('JUNK');
  u32(2);
  u16(0);
  str('data');
  u32(dataLen);
  return b64(h);
}

// IS THIS TEXT ALREADY VOICED - every piece of it kept on the phone in the chosen voice, so it plays with no network
// (the listen button's mark, 2026-10-15: «індикатор що цей текст вже озвучений і є офлайн»).
const voicedListeners = new Set<() => void>();
export function subscribeVoiced(l: () => void) {
  voicedListeners.add(l);
  return () => {
    voicedListeners.delete(l);
  };
}
// Cards whose voice Gemini is making right now (any of their pieces) - the listen button's single tick.
const making = new Map<string, number>();
export function isVoicing(id: string) {
  return (making.get(id) ?? 0) > 0;
}
function markMaking(id: string | undefined, delta: number) {
  if (!id) return;
  making.set(id, Math.max(0, (making.get(id) ?? 0) + delta));
  voicedListeners.forEach((l) => l());
}

// Where a piece's voice is kept: by voice, its style and the text («v3»: what was kept under the seed experiment, v2,
// may be minutes of runaway sound - never reused).
function voiceFile(name: string, text: string) {
  return `${hash(`v3|${name}${VOICES.find((v) => v.id === name)?.style ?? ''}|${text}`)}.wav`;
}

export async function isVoicedOffline(text: string): Promise<boolean> {
  const name = await getVoiceName();
  const pieces = chunks(text);
  if (!pieces.length) return false;
  for (const piece of pieces) {
    if (!(await voiceStore.exists(voiceFile(name, piece)))) return false;
  }
  return true;
}
// Minutes of voice kept on this phone: the files' sound (24 kHz, 16 bit, mono - 48 000 bytes a second).
export async function keptVoiceSeconds(): Promise<number> {
  const files = await voiceStore.list();
  return files.reduce((bytes, f) => bytes + Math.max(0, f.size - 54), 0) / 48000;
}

// The model that voiced last - asked first, so one listening keeps one voice.
let lastVoiceModel: string | null = null;

async function geminiVoice(text: string, key: string, name?: string): Promise<string> {
  const VOICE_NAME = name ?? (await getVoiceName());
  // «v3»: what was kept under the seed experiment (v2) may be minutes of runaway sound - never reused.
  const file = voiceFile(VOICE_NAME, text);
  const hit = await voiceStore.exists(file);
  mark(`cache ${hit ? 'HIT' : 'miss'} ${text.length} chars`);
  if (hit) return voiceStore.uriOf(file);
  let lastError = 'Gemini не озвучив';
  // ONE VOICE ACROSS THE PIECES (2026-10-15, the user: «при кожному новому програванні грає інший голос»). The pieces
  // of one listening came from two different models (3.1 for one, 2.5 for the next when 3.1 was busy) - two
  // different people. So a model that has voiced is asked first next time, and the other only when it errors.
  // A fixed seed with a low temperature was tried first and REMOVED the same day: 3.1 then answered with no audio at
  // all and 2.5 talked on into 11 minutes of sound for 386 characters (the first sound came 164 s after the tap).
  const own = VOICES.find((v) => v.id === VOICE_NAME)?.model;
  const order = own ? [own] : [...new Set([...(lastVoiceModel && TTS_MODELS.includes(lastVoiceModel) ? [lastVoiceModel] : []), ...TTS_MODELS])];
  for (const model of order) {
    // 3.8 WITH ITS STYLE (2026-10-15, the user: «дивись одразу стиль» - Nika in AI Studio was «Friendly»). 3.8 takes
    // a style only through the Interactions API: the text verbatim, the style as a short `speech_metadata` note on it.
    // The answer is a whole WAV. Refused there, the same voice is asked through generateContent, without the style.
    const style = model === TTS_38 ? VOICES.find((v) => v.id === VOICE_NAME)?.style : undefined;
    let got: { wav: string } | { pcm: string; rate: number } | null = null;
    if (model === TTS_38) {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          model,
          input: [
            {
              type: 'user_input',
              content: [{ type: 'text', text, ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {}) }],
            },
          ],
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice: VOICE_NAME }] },
        }),
      }).catch(() => null);
      const data: any = response ? await response.json().catch(() => null) : null;
      if (response?.ok) {
        const audio = ((data?.steps ?? []) as any[])
          .filter((st) => st?.type === 'model_output')
          .flatMap((st) => (st?.content ?? []) as any[])
          .filter((c) => c?.type === 'audio' && c?.data)
          .pop();
        const wav: string | undefined = audio?.data;
        const u = data?.usage;
        const seconds = wav ? Math.max(0, pcmBytes(wav) - 44) / 48000 : 0;
        recordGemini('tts', model, u ? { promptTokenCount: u.total_input_tokens ?? u.input_tokens, candidatesTokenCount: u.total_output_tokens ?? u.output_tokens } : undefined, seconds);
        if (wav) got = { wav };
        else mark(`tts ${model} (interactions) gave no audio`);
      } else {
        mark(`tts ${model} interactions refused: ${String(data?.error?.message ?? response?.status ?? 'no network').slice(0, 120)}`);
      }
    }
    if (!got) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text:
                    model === TTS_38
                      ? `## Transcript:\n${text}`
                      : `Прочитай українською спокійно, тепло і природно, як близька людина:\n\n${text}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } } },
          },
        }),
      });
      const data: any = await response.json().catch(() => null);
      if (!response.ok) {
        lastError = (data?.error?.message as string | undefined) ?? `Gemini відповів ${response.status}`;
        mark(`tts ${model} refused: ${lastError.slice(0, 120)}`);
        continue;
      }
      const inline = data?.candidates?.[0]?.content?.parts?.find((p: { inlineData?: unknown }) => p.inlineData)?.inlineData as
        | { mimeType?: string; data?: string }
        | undefined;
      const rate = Number(/rate=(\d+)/.exec(inline?.mimeType ?? '')?.[1] ?? 24000);
      // Counted whether it is kept or not: an answer is paid for either way (geminiUsage).
      recordGemini('tts', model, data?.usageMetadata, inline?.data ? pcmBytes(inline.data) / (rate * 2) : 0);
      if (!inline?.data) {
        mark(`tts ${model} gave no audio (${data?.candidates?.[0]?.finishReason ?? '?'})`);
        continue;
      }
      got = { pcm: inline.data, rate };
    }
    mark(`tts voiced by ${model} (${VOICE_NAME}${'wav' in got ? `, style ${style ?? '-'}` : ''})`);
    // A voice that runs far longer than the text could take to say has gone wrong (speech is ~15 characters a
    // second; a quarter of that, plus slack, is the most it may take) - not kept, the next model is asked.
    const seconds = 'wav' in got ? Math.max(0, pcmBytes(got.wav) - 44) / 48000 : pcmBytes(got.pcm) / (got.rate * 2);
    if (seconds > 20 + text.length / 4) {
      mark(`tts ${model} ran on: ${Math.round(seconds)} s for ${text.length} chars`);
      continue;
    }
    lastVoiceModel = model;
    const uri = await voiceStore.write(file, 'wav' in got ? got.wav : wavHeader(pcmBytes(got.pcm), got.rate) + got.pcm);
    voicedListeners.forEach((l) => l());
    return uri;
  }
  throw new Error(lastError);
}

// `span`: where this piece stands in the whole listening - the seconds before it, and the length of all of it so far
// as known - so the time shown is the listening's, not the piece's (2026-10-15: the user saw 10:55, then 2:30).
// `startAt`: seconds into the piece (a ±15 s step that crossed into it). `nearEnd`: called once, a few seconds before
// the piece ends - the moment to make the next one ready.
function playFile(
  uri: string,
  mine: number,
  text: string,
  title: string,
  opts?: { span?: () => { before: number; total: number }; startAt?: number; nearEnd?: () => void }
): Promise<void> {
  const span = opts?.span;
  return new Promise((resolve) => {
    if (mine !== run) return resolve();
    let p: AudioPlayer;
    if (nextPlayer && nextPlayer.uri === uri) {
      p = nextPlayer.p;
      nextPlayer = null;
    } else {
      dropNextPlayer();
      p = createAudioPlayer({ uri });
    }
    player = p;
    let warned = false;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sub.remove();
      if (player === p) dropPlayer();
      else
        try {
          p.remove();
        } catch {
          // gone
        }
      if (endPiece === finish) endPiece = null;
      resolve();
    };
    endPiece = finish;
    let last = 0;
    let heard = false;
    mark('player created');
    const sub = p.addListener('playbackStatusUpdate', (s) => {
      if (!heard && s.playing && (s.currentTime || 0) > 0) {
        heard = true;
        mark('FIRST SOUND');
      }
      if (mine !== run) return finish();
      if (s.didJustFinish) return finish();
      const now = Date.now();
      // Paused from the shade or the lock screen goes past pauseVoice: read it off the player itself, once it has
      // sounded (before that «not playing» is only loading). A change is told at once - a paused player sends no
      // more updates, so one held back by the 250 ms below would never arrive.
      // (Buffering is not a pause: the button flickered to «play» for a moment as a piece started.)
      const paused = heard ? !s.playing && !s.didJustFinish && !s.isBuffering : state.paused;
      const turned = paused !== state.paused;
      if (turned) {
        if (paused) armPauseTimer();
        else clearPauseTimer();
      }
      if (!warned && s.duration > 0 && s.duration - (s.currentTime || 0) < 4) {
        warned = true;
        opts?.nearEnd?.();
      }
      if (turned || now - last > 250) {
        last = now;
        const d = s.duration || 0;
        const at = span?.();
        emit({
          position: (at?.before ?? 0) + (s.currentTime || 0),
          duration: at ? Math.max(at.total, at.before + d) : d,
          paused,
          sentence: d > 0 ? sentenceAt(text, (s.currentTime || 0) / d) : state.sentence,
        });
      }
    });
    // THE SHADE and the lock screen: Android's own media card, with pause and ±15 s.
    try {
      p.setActiveForLockScreen(true, { title, artist: 'mindEva · Думки' }, { showSeekForward: true, showSeekBackward: true });
    } catch {
      // not available here
    }
    if (opts?.startAt && opts.startAt > 0) p.seekTo(opts.startAt).catch?.(() => {});
    p.play();
  });
}

function speakPhone(text: string, mine: number): Promise<void> {
  return new Promise((resolve) => {
    if (mine !== run) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (endPiece === finish) endPiece = null;
      resolve();
    };
    endPiece = finish;
    emit({ sentence: sentencesOf(text)[0] ?? '' });
    Speech.speak(text, { language: 'uk-UA', onDone: finish, onStopped: finish, onError: finish });
  });
}

// Reads the given cards in order; each is {title, text, thoughtId}. The NEXT piece is voiced while the current one
// plays; «наступна / попередня» jump between cards; resolves when done or stopped.
// TEMPORARY (2026-10-15): where the seconds between a tap and the first sound go. Remove once found.
let t0 = 0;
const mark = (what: string) => console.log(`[voice-timing] ${what} +${Date.now() - t0}ms`);
export async function speakThoughts(items: { title: string; text: string; thoughtId?: string }[]) {
  t0 = Date.now();
  mark('tap');
  await stopVoice();
  mark('stopped');
  const mine = run;
  await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {});
  mark('audio mode');
  const key = await getGeminiKey();
  mark('key');
  const pieces = items.flatMap((it, i) => chunks(it.text).map((text) => ({ text, title: it.title, thoughtId: it.thoughtId, item: i })));
  const voiced = new Map<number, Promise<string | null>>();
  // Seconds of each voiced piece, read off its file (24 kHz, 16 bit, mono).
  const lengths = new Map<number, number>();
  // The files already made, by piece - read without waiting (making the next player ready).
  const ready = new Map<number, string>();
  const voice = (k: number): Promise<string | null> => {
    if (k < 0 || k >= pieces.length) return Promise.resolve(null);
    if (!voiced.has(k)) {
      const owner = pieces[k].thoughtId;
      markMaking(owner, 1);
      const job = (key ? geminiVoice(pieces[k].text, key).catch(() => null) : Promise.resolve(null)).finally(() => markMaking(owner, -1));
      voiced.set(
        k,
        job.then(async (uri) => {
          if (uri) {
            const size = await voiceStore.sizeOf(uri);
            if (size) lengths.set(k, Math.max(0, size - 54) / 48000);
            ready.set(k, uri);
          }
          return uri;
        })
      );
    }
    return voiced.get(k)!;
  };
  // Where piece k stands in the whole listening: a voiced piece counts its real length, the rest an estimate from
  // the speaking rate heard so far (characters a second).
  const spanAt = (k: number) => {
    let chars = 0;
    let secs = 0;
    lengths.forEach((len, i) => {
      chars += pieces[i].text.length;
      secs += len;
    });
    const rate = secs > 0 ? chars / secs : 14;
    let before = 0;
    let total = 0;
    pieces.forEach((p, i) => {
      const len = lengths.get(i) ?? p.text.length / rate;
      if (i < k) before += len;
      total += len;
    });
    return { before, total };
  };
  session = { k: 0, count: pieces.length, lengths };
  let k = 0;
  let startAt = 0;
  while (k < pieces.length) {
    if (mine !== run) return;
    const piece = pieces[k];
    if (session) session.k = k;
    const here = spanAt(k);
    emit({
      playing: true,
      paused: false,
      title: piece.title,
      thoughtId: piece.thoughtId,
      index: piece.item + 1,
      total: items.length,
      position: here.before + startAt,
      duration: here.total,
      pieceText: piece.text,
      sentence: '',
      source: state.thoughtId === piece.thoughtId ? state.source : null,
    });
    // Two ahead are being voiced while this one plays (the first two from the tap), so the next is ready in time.
    voice(k + 1);
    const uri = await voice(k);
    mark(`piece ${k} voiced (${uri ? 'file' : 'none'})`);
    voice(k + 2);
    if (mine !== run) return;
    if (jumpToItem === null) {
      if (uri) {
        emit({ source: 'gemini' });
        const kk = k;
        const from = startAt;
        startAt = 0;
        await playFile(uri, mine, piece.text, piece.title, {
          span: () => spanAt(kk),
          startAt: from,
          // The next piece's player, loaded and waiting, so it starts the moment this one ends.
          nearEnd: () => {
            const next = ready.get(kk + 1);
            if (next && !nextPlayer && mine === run) nextPlayer = { uri: next, p: createAudioPlayer({ uri: next }) };
          },
        });
      } else {
        emit({ source: 'phone' });
        await speakPhone(piece.text, mine);
      }
    }
    if (mine !== run) return;
    if (jumpPiece) {
      k = jumpPiece.k;
      startAt = jumpPiece.at;
      jumpPiece = null;
      continue;
    }
    if (jumpToItem !== null) {
      const target = jumpToItem;
      jumpToItem = null;
      k = pieces.findIndex((p) => p.item === target);
      if (k < 0) break;
      continue;
    }
    // Paused on the phone's voice (it cannot pause): wait here until play or stop.
    while (state.paused && mine === run && !player && jumpToItem === null) await new Promise((r) => setTimeout(r, 200));
    if (jumpToItem !== null) continue;
    k += 1;
  }
  if (mine === run) {
    session = null;
    dropNextPlayer();
    emit(IDLE);
  }
}

// Space taken by the kept voices, and a cleanup of the oldest beyond a limit (a voice can always be made again).
export async function trimVoices(maxBytes = 150 * 1024 * 1024) {
  const files = (await voiceStore.list()).sort((a, b) => b.at - a.at);
  let total = 0;
  for (const f of files) {
    total += f.size;
    if (total > maxBytes) await voiceStore.remove(f.uri);
  }
}
