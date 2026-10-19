import * as FileSystem from 'expo-file-system/legacy';
import { GEMINI_MODEL, GeminiError } from './gemini';
import { getGeminiKey } from './geminiKey';
import type { Thought } from '../hooks/useThoughts';
import { recordGemini } from './geminiUsage';
import { imagePartOf } from './thoughtImages';

// THE THOUGHTS' ASSISTANT (2026-10-15, the user: «виділити й зрезюмувати, а можна все виділити і ще написати
// запитання» - and Gemini should see the videos and the pictures too). One call per request, no session: the picked
// thoughts go in as text, their pictures as images and a YouTube video as the video itself; what comes back is a
// card of its own. The answer is asked for the way the user likes to be answered - restated, plain, in order, ready
// to be listened to.
//
// Failures never cost a thought: the card that waits for the answer is written first (useThoughts), and a failed
// call only marks it «не вдалося» with a retry.

// The models to try, in order. Names move on (two were already retired under this app); when every known one is
// refused, the API itself is asked which models this key may use now, and the newest «flash» one is taken.
const KNOWN = [GEMINI_MODEL, 'gemini-flash-latest'];
let discovered: string[] | null = null;
async function liveModels(k: string): Promise<string[]> {
  if (discovered) return discovered;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}&pageSize=200`);
    const d = await r.json();
    const names = ((d?.models ?? []) as { name: string; supportedGenerationMethods?: string[] }[])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /flash/.test(n) && !/(tts|image|live|audio|embedding|thinking-exp|lite)/.test(n))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    discovered = names.slice(0, 3);
  } catch {
    discovered = [];
  }
  return discovered;
}
const endpoint = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

type Part = { text: string } | { inlineData: { mimeType: string; data: string } } | { fileData: { fileUri: string; mimeType?: string } };

export const isYouTube = (url: string) => /(?:youtube\.com\/(?:watch|shorts\/)|youtu\.be\/)/i.test(url);

async function key(): Promise<string> {
  const k = await getGeminiKey();
  if (!k) throw new GeminiError('Немає ключа Gemini - додай його в Налаштуваннях (розділ «Gemini»).');
  return k;
}

// One call, with the next model tried when the first is busy (503/429) or gone (404).
async function call(parts: Part[], k: string): Promise<string> {
  let first: Error | null = null;
  let last: Error = new GeminiError('Gemini не відповів');
  const tried = new Set<string>();
  const queue = [...KNOWN];
  let askedLive = false;
  while (queue.length) {
    const model = queue.shift()!;
    if (tried.has(model)) continue;
    tried.add(model);
    // A busy model (503) or the per-minute limit (429) is waited out twice on the same model before moving on.
    let response!: Response;
    let data: { error?: { message?: string }; candidates?: { content?: { parts?: { text?: string }[] } }[] } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, attempt === 1 ? 2500 : 7000));
      try {
        response = await fetch(endpoint(model, k), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts }] }),
        });
      } catch {
        throw new GeminiError('Немає звʼязку з Gemini - перевір інтернет');
      }
      data = await response.json().catch(() => null);
      if (response.status !== 503 && response.status !== 429) break;
    }
    if (!response.ok) {
      last = new GeminiError((data?.error?.message as string | undefined) ?? `Gemini відповів ${response.status}`, response.status);
      first = first ?? last;
      if ([400, 404, 429, 500, 503].includes(response.status)) {
        if (!queue.length && !askedLive) {
          askedLive = true;
          queue.push(...(await liveModels(k)));
        }
        continue;
      }
      throw last;
    }
    recordGemini('text', model, (data as { usageMetadata?: Parameters<typeof recordGemini>[2] } | null)?.usageMetadata);
    const text = (data?.candidates?.[0]?.content?.parts as { text?: string }[] | undefined)?.map((p) => p.text ?? '').join('').trim();
    if (text) return text;
    last = new GeminiError('Gemini не дав відповіді - можливо, запит потрапив під фільтр безпеки');
  }
  throw first ?? last;
}

// A picture as the API takes it: downloaded once into the cache, sent as base64. A picture that will not come is
// left out - the words still go.
async function imagePart(url: string): Promise<Part | null> {
  try {
    const name = `thought-img-${hash(url)}`;
    const local = `${FileSystem.cacheDirectory}${name}`;
    const info = await FileSystem.getInfoAsync(local);
    if (!info.exists) await FileSystem.downloadAsync(url, local);
    const data = await FileSystem.readAsStringAsync(local, { encoding: FileSystem.EncodingType.Base64 });
    if (!data || data.length > 6_000_000) return null;
    const mimeType = /\.png(\?|$)/i.test(url) ? 'image/png' : /\.webp(\?|$)/i.test(url) ? 'image/webp' : 'image/jpeg';
    return { inlineData: { mimeType, data } };
  } catch {
    return null;
  }
}

export function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// What one thought says, for the prompt.
function describe(t: Thought, i: number): string {
  const lines = [`Думка ${i + 1}:`];
  const src = t.source;
  if (src?.kind === 'link') {
    lines.push(`Матеріал: ${src.title || src.url}${src.siteName ? ` (${src.siteName})` : ''} - ${src.url}`);
    if (t.videoGist) lines.push(`Зміст відео: ${t.videoGist}`);
  }
  if (src?.kind === 'text') lines.push(`Текст: ${src.text}`);
  if (t.images?.length) lines.push(`До думки додано ${t.images.length === 1 ? 'зображення' : `зображень: ${t.images.length}`} (вони йдуть нижче разом із запитом).`);
  if (t.ai === 'answer' && t.question) lines.push(`Питання: ${t.question}`);
  if (t.felt) lines.push(src ? `Що зачепило людину: ${t.felt}` : t.ai ? `Висновок: ${t.felt}` : `Її думка: ${t.felt}`);
  return lines.join('\n');
}

const VOICE = `Звертайся до людини на «ти», тепло і просто. Пиши українською, як уважний співрозмовник, якого людина потім слухатиме вголос: простими реченнями, без
розмітки (жодних зірочок, решіток, таблиць), короткими абзацами. Спершу одним-двома реченнями - суть. Далі по порядку
головні думки. В кінці - що з цього випливає для людини, конкретно. Нічого не вигадуй понад те, що дано; якщо чогось
не видно або не вистачає - скажи прямо. Не повторюй дослівно, а переказуй.`;

async function partsFor(thoughts: Thought[], ask: string): Promise<Part[]> {
  const parts: Part[] = [{ text: `${ask}\n\n${VOICE}\n\n${thoughts.map(describe).join('\n\n')}` }];
  // Pictures of the picked thoughts, a few at most.
  const pictures = thoughts.map((t) => (t.source?.kind === 'link' ? t.source.imageUrl : undefined)).filter((u): u is string => !!u).slice(0, 4);
  for (const url of pictures) {
    const p = await imagePart(url);
    if (p) parts.push(p);
  }
  // The pictures people attached to the thoughts themselves (their own photos, screenshots), up to six in all.
  const own = thoughts.flatMap((t) => (t.images ?? []).map((i) => i.uri)).slice(0, 6);
  for (const uri of own) {
    const p = await imagePartOf(uri);
    if (p) parts.push(p);
  }
  // One YouTube video not yet seen goes in as itself (the rest are known by their gist).
  const video = thoughts.find((t) => t.source?.kind === 'link' && isYouTube(t.source.url) && !t.videoGist);
  if (video && video.source?.kind === 'link') parts.push({ fileData: { fileUri: video.source.url } });
  return parts;
}

export async function summarizeThoughts(thoughts: Thought[]): Promise<string> {
  const k = await key();
  return call(
    await partsFor(
      thoughts,
      'Ось кілька думок і матеріалів однієї людини, разом із тим, що її в них зачепило. Перекажи, що їх обʼєднує і до чого вони ведуть - так, щоб людина побачила свою думку ясніше, ніж вона її сказала.'
    ),
    k
  );
}

export async function askAboutThoughts(thoughts: Thought[], question: string): Promise<string> {
  const k = await key();
  return call(await partsFor(thoughts, `Людина ставить питання про свої думки і матеріали нижче. Питання: «${question}». Дай відповідь саме на нього, спираючись на те, що дано.`), k);
}

// WHAT IS IN A VIDEO (YouTube only - the API watches it by its address), kept on its card once.
export async function videoGist(url: string): Promise<string> {
  const k = await key();
  return call(
    [
      { text: `Подивись це відео і коротко перекажи українською його зміст: про що воно, головні тези, висновок. До 150 слів, без розмітки.` },
      { fileData: { fileUri: url } },
    ],
    k
  );
}
