import { getPexelsKey } from './pexelsKey';
import { toSearchTerm } from './queryToEnglish';

// A free picture library to pull tile backgrounds from, the way Notion's
// own cover picker reaches into Unsplash.
//
// TWO sources, and the order matters. Openverse is the default because it
// needs NOTHING: no account, no key, no sign-up page that can hand back
// "An unexpected error occurred" and leave someone stuck - which is
// exactly what Pexels' own registration did. It is the search behind
// WordPress's media library, and filtered to CC0 and public domain the
// pictures carry no attribution requirement either.
//
// Pexels stays as the better-curated option for anyone who does have a
// key: its photographs are chosen, Openverse's are indexed.
//
// Both only ever read. A search is a GET; nothing here uploads, deletes
// or touches an account.

export type StockSource = 'open' | 'pexels';

export type StockPhoto = {
  // Prefixed with its source, so two libraries can never collide in one
  // list of keys.
  id: string;
  // Small enough for a grid of results.
  thumbUrl: string;
  // The real thing, to crop into a tile.
  fullUrl: string;
  width: number;
  height: number;
  // Whoever made it. Not a legal requirement for what is fetched here -
  // both sources are filtered to licences that ask for nothing - just
  // good manners toward the person who made the picture free to use.
  credit: string;
};

// Whatever the server itself said, when it said anything. A bare status
// number sends the next person hunting; "page_size may not exceed 20 for
// anonymous requests" - which is what a 401 from Openverse actually
// meant - points straight at the line to change.
// A credit is a person's name, and now and then it arrives as a block of
// HTML instead - Wikimedia's own markup, tags and all. Whatever is left
// after the tags is the name.
function cleanCredit(raw: string): string {
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

async function describe(response: Response, who: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    if (body.detail) return `${who}: ${body.detail}`;
  } catch {
    // Not JSON, or already consumed - the status is all there is.
  }
  return `${who} відповів помилкою (${response.status})`;
}

export class StockPhotosNotConfigured extends Error {
  constructor() {
    super('Немає ключа Pexels');
  }
}

// ---- Openverse: no key, no account -----------------------------------

type OpenverseResult = {
  id: string;
  title?: string;
  creator?: string;
  url: string;
  thumbnail?: string;
  width?: number;
  height?: number;
};

async function searchOpenverse(query: string, page: number): Promise<StockPhoto[]> {
  const trimmed = (await toSearchTerm(query)).trim();
  const params = [
    // Twenty is the ceiling for an anonymous request, and going over it
    // is refused with a 401 - a status that says "unauthorised" for what
    // is really "too many at once". Asking for thirty (copied from the
    // Pexels call below) is what broke this the first time.
    `page_size=20`,
    `page=${page}`,
    // Public domain and CC0 only: everything else would want crediting
    // somewhere, and a tile background is no place to put a credit.
    `license=cc0,pdm`,
    `size=large`,
    // Photographs only, and only in formats that can actually be drawn.
    // Without these the search returns the whole indexed web: maps and
    // coats of arms as SVG, which React Native cannot render at all and
    // whose thumbnails Openverse itself fails to make (424). With them
    // every result is a real photograph from StockSnap or Flickr.
    `category=photograph`,
    `extension=jpg,png`,
    `q=${encodeURIComponent(trimmed || 'texture')}`,
  ];
  const response = await fetch(`https://api.openverse.org/v1/images/?${params.join('&')}`, {
    headers: { 'User-Agent': 'mindEva' },
  });
  if (!response.ok) throw new Error(await describe(response, 'Openverse'));
  const data = (await response.json()) as { results?: OpenverseResult[] };
  return (data.results ?? [])
    .filter((item) => !!item.url)
    .map((item) => ({
      id: `open-${item.id}`,
      thumbUrl: item.thumbnail || item.url,
      fullUrl: item.url,
      width: item.width ?? 0,
      height: item.height ?? 0,
      credit: cleanCredit(item.creator || item.title || '') || 'Відкрита ліцензія',
    }));
}

// ---- Pexels: better curated, needs a free key -------------------------

type PexelsResult = {
  id: number;
  width: number;
  height: number;
  photographer: string;
  src: { medium: string; large2x: string };
};

async function searchPexels(query: string, page: number): Promise<StockPhoto[]> {
  const key = await getPexelsKey();
  if (!key) throw new StockPhotosNotConfigured();
  const trimmed = (await toSearchTerm(query)).trim();
  const path = trimmed
    ? `/v1/search?query=${encodeURIComponent(trimmed)}&per_page=30&page=${page}&orientation=square`
    : `/v1/curated?per_page=30&page=${page}`;
  const response = await fetch(`https://api.pexels.com${path}`, { headers: { Authorization: key } });
  if (response.status === 401) throw new Error('Ключ Pexels не підійшов');
  if (!response.ok) throw new Error(await describe(response, 'Pexels'));
  const data = (await response.json()) as { photos?: PexelsResult[] };
  return (data.photos ?? []).map((photo) => ({
    id: `pexels-${photo.id}`,
    thumbUrl: photo.src.medium,
    fullUrl: photo.src.large2x,
    width: photo.width,
    height: photo.height,
    credit: photo.photographer,
  }));
}

export async function searchStockPhotos(
  query: string,
  source: StockSource = 'open',
  page = 1
): Promise<StockPhoto[]> {
  return source === 'pexels' ? searchPexels(query, page) : searchOpenverse(query, page);
}
