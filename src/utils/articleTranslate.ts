import { deleteDoc, doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { setDoc } from './owned';
import { askGemini, GeminiError } from './gemini';
import { getGeminiKey } from './geminiKey';
import type { ArticleBlock, SavedArticle } from './articleReader';

// A saved article, translated into Ukrainian once by Gemini and kept
// beside the original in `linkArticleTranslations/<linkId>` - its own
// document, since an original and its translation together could pass
// Firestore's 1 MB per document on a long read. Read offline like the
// article itself; the reader switches between the two.
//
// Gemini rather than Google Translate (Chrome's engine) by the user's
// choice: the key is already in the app, and its free tier needs no card.

export type SavedTranslation = {
  lang: 'uk';
  title?: string;
  blocks: ArticleBlock[];
  translatedAt: number;
};

// A chunk small enough to come back whole in one answer, large enough
// that a long article is a handful of calls rather than dozens.
const CHUNK_CHARS = 5000;
const CHUNK_ITEMS = 60;
const RETRIES = 3;

function chunkIndices(texts: string[]): number[][] {
  const chunks: number[][] = [];
  let current: number[] = [];
  let size = 0;
  texts.forEach((text, i) => {
    if (current.length > 0 && (size + text.length > CHUNK_CHARS || current.length >= CHUNK_ITEMS)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(i);
    size += text.length;
  });
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// The answer is asked for as a bare JSON array, but a model sometimes
// wraps it in a fence or an object - take the array wherever it is.
function parseArray(raw: string): string[] | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!Array.isArray(value) && value && typeof value === 'object') {
    value = Object.values(value as Record<string, unknown>).find(Array.isArray);
  }
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) return null;
  return value as string[];
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function translateBatch(texts: string[], apiKey: string): Promise<string[]> {
  const prompt =
    'Translate each string in the JSON array below into Ukrainian. ' +
    `Return ONLY a JSON array of exactly ${texts.length} strings, one translation per input string, in the same order. ` +
    'Translate faithfully, without adding or leaving out anything and without commentary. ' +
    'Keep names, numbers, links and punctuation as they are. An empty string stays empty; a string already in Ukrainian comes back unchanged.\n\n' +
    JSON.stringify(texts);
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const parsed = parseArray(await askGemini(prompt, apiKey, { json: true }));
      if (parsed && parsed.length === texts.length) return parsed;
    } catch (e) {
      // The free tier's per-minute limit: wait it out rather than fail
      // halfway through a long article.
      if (e instanceof GeminiError && e.status === 429 && attempt < RETRIES) {
        await wait(20000 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
  throw new Error('Gemini повернув переклад не в тому вигляді - спробуйте ще раз.');
}

export async function translateArticle(
  linkId: string,
  article: SavedArticle,
  onProgress: (done: number, total: number) => void
): Promise<void> {
  const apiKey = await getGeminiKey();
  if (!apiKey) throw new Error('Додайте ключ Gemini: Налаштування → «Gemini у чаті».');
  const texts = [article.title ?? '', ...article.blocks.map((b) => b.text)];
  const chunks = chunkIndices(texts);
  const translated: string[] = new Array(texts.length).fill('');
  for (let c = 0; c < chunks.length; c++) {
    onProgress(c, chunks.length);
    const indices = chunks[c];
    const result = await translateBatch(
      indices.map((i) => texts[i]),
      apiKey
    );
    indices.forEach((textIndex, k) => {
      translated[textIndex] = result[k];
    });
  }
  onProgress(chunks.length, chunks.length);
  const data: Record<string, unknown> = {
    linkId,
    lang: 'uk',
    blocks: article.blocks.map((b, i) => ({ kind: b.kind, text: translated[i + 1] || b.text })),
    translatedAt: Date.now(),
  };
  if (translated[0]) data.title = translated[0];
  await setDoc(doc(db, 'linkArticleTranslations', linkId), data);
}

export function watchTranslation(linkId: string, onChange: (translation: SavedTranslation | null) => void): () => void {
  return onSnapshot(
    doc(db, 'linkArticleTranslations', linkId),
    (snapshot) => {
      const data = snapshot.data();
      onChange(data ? (data as SavedTranslation) : null);
    },
    () => onChange(null)
  );
}

export async function deleteTranslation(linkId: string): Promise<void> {
  await deleteDoc(doc(db, 'linkArticleTranslations', linkId));
}
