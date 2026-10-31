import { Platform } from 'react-native';
import { arrayRemove, arrayUnion, deleteDoc, deleteField, doc, onSnapshot, updateDoc } from '../firestore';
import { db } from '../firebase';
import { setDoc } from './owned';
import { generateId } from './documentBlocks';

// "Зберегти для читання": a link's page, fetched once and boiled down to
// its article - title and body text, the site's menus, ads and comments
// left behind - by Mozilla's Readability, the algorithm behind Firefox's
// reader view. Kept as plain text in its own `linkArticles/<linkId>`
// document (not on the link itself: every list of links loads every link
// document, and a whole article on each would weigh them all down), so
// it opens with no connection and syncs to the other device like
// anything else.

export type ArticleBlock = { kind: 'p' | 'h' | 'li' | 'q'; text: string };

export type SavedArticle = {
  title?: string;
  byline?: string;
  siteName?: string;
  blocks: ArticleBlock[];
  savedAt: number;
};

// A piece of an article the user marked while reading - what they called
// a quote. Kept on the link card first; sent on to a note from there.
export type LinkFragment = { id: string; text: string; createdAt: number };

// Pages written for a phone browser come back as phone pages - and a few
// sites refuse the bare default client outright.
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const FETCH_TIMEOUT_MS = 20000;
// Far past any real article (a long Wikipedia page is ~90k characters),
// and well inside Firestore's 1 MB per document.
const MAX_CHARS = 300000;

const BLOCK_TAGS: Record<string, ArticleBlock['kind']> = {
  P: 'p',
  H1: 'h',
  H2: 'h',
  H3: 'h',
  H4: 'h',
  H5: 'h',
  H6: 'h',
  LI: 'li',
  BLOCKQUOTE: 'q',
  PRE: 'p',
};

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

type ElementLike = { tagName: string; textContent: string | null; children: ArrayLike<ElementLike> };

export class ArticleError extends Error {}

export async function extractArticle(url: string): Promise<Omit<SavedArticle, 'savedAt'>> {
  // A browser page may not read another site at all (CORS) - only the
  // phone can fetch a page for itself. A saved article still READS
  // everywhere; it is only the saving that has to happen on the phone.
  if (Platform.OS === 'web') {
    throw new ArticleError('Зберегти статтю можна з телефону - браузер не дає прочитати чужу сторінку.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let html: string;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'uk,en;q=0.8' },
      signal: controller.signal,
    });
    if (!response.ok) throw new ArticleError(`Сайт відповів помилкою ${response.status}.`);
    html = await response.text();
  } catch (e) {
    if (e instanceof ArticleError) throw e;
    throw new ArticleError('Сторінка не завантажилась - перевірте інтернет.');
  } finally {
    clearTimeout(timer);
  }

  // Loaded on first use rather than at startup: nothing else in the app
  // needs an HTML parser, and a module that fails to initialise here
  // turns into this button's error instead of a screen that will not open.
  const [{ parseHTML }, { Readability }] = await Promise.all([import('linkedom'), import('@mozilla/readability')]);
  const { document } = parseHTML(html);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const article = new Readability(document as any).parse();
  if (!article?.content) {
    throw new ArticleError('На цій сторінці не знайшлося статті - схоже, це не текст, а застосунок чи відео.');
  }

  const { document: body } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`);
  const blocks: ArticleBlock[] = [];
  let chars = 0;
  const walk = (node: ElementLike) => {
    const children = Array.from(node.children ?? []);
    for (const el of children) {
      if (chars > MAX_CHARS) return;
      const kind = BLOCK_TAGS[el.tagName];
      if (kind) {
        const text = clean(el.textContent ?? '');
        if (!text) continue;
        blocks.push({ kind, text });
        chars += text.length;
      } else {
        walk(el);
      }
    }
  };
  walk(body.body as unknown as ElementLike);
  if (blocks.length === 0) throw new ArticleError('Статтю знайдено, але тексту в ній немає.');

  const result: Omit<SavedArticle, 'savedAt'> = { blocks };
  if (article.title) result.title = clean(article.title);
  if (article.byline) result.byline = clean(article.byline);
  if (article.siteName) result.siteName = clean(article.siteName);
  return result;
}

export async function saveArticleForLink(linkId: string, url: string): Promise<void> {
  const article = await extractArticle(url);
  const savedAt = Date.now();
  await setDoc(doc(db, 'linkArticles', linkId), { ...article, linkId, savedAt });
  await updateDoc(doc(db, 'links', linkId), { articleSavedAt: savedAt });
}

export async function deleteArticleForLink(linkId: string): Promise<void> {
  await deleteDoc(doc(db, 'linkArticles', linkId));
  // Its translation goes with it (see articleTranslate) - a translation of
  // an article that is no longer kept is nothing to read.
  await deleteDoc(doc(db, 'linkArticleTranslations', linkId)).catch(() => {});
  await updateDoc(doc(db, 'links', linkId), { articleSavedAt: deleteField() }).catch(() => {});
}

// One article, live - a GET by id, which the owner-only rules answer for
// a missing document too (see firestore.rules.owner-only).
export function watchArticle(linkId: string, onChange: (article: SavedArticle | null) => void): () => void {
  return onSnapshot(
    doc(db, 'linkArticles', linkId),
    (snapshot) => {
      const data = snapshot.data();
      onChange(data ? (data as SavedArticle) : null);
    },
    () => onChange(null)
  );
}

export async function addFragment(linkId: string, text: string): Promise<void> {
  const fragment: LinkFragment = { id: generateId(), text: text.trim(), createdAt: Date.now() };
  if (!fragment.text) return;
  await updateDoc(doc(db, 'links', linkId), { fragments: arrayUnion(fragment) });
}

export async function removeFragment(linkId: string, fragment: LinkFragment): Promise<void> {
  await updateDoc(doc(db, 'links', linkId), { fragments: arrayRemove(fragment) });
}
