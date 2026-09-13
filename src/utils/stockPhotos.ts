import { getPexelsKey } from './pexelsKey';

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
  const trimmed = query.trim();
  const params = [
    `page_size=30`,
    `page=${page}`,
    // Public domain and CC0 only: everything else would want crediting
    // somewhere, and a tile background is no place to put a credit.
    `license=cc0,pdm`,
    `size=large`,
    trimmed ? `q=${encodeURIComponent(trimmed)}` : 'q=texture',
  ];
  const response = await fetch(`https://api.openverse.org/v1/images/?${params.join('&')}`, {
    headers: { 'User-Agent': 'mindEva' },
  });
  if (!response.ok) throw new Error(`Openverse відповів помилкою (${response.status})`);
  const data = (await response.json()) as { results?: OpenverseResult[] };
  return (data.results ?? [])
    .filter((item) => !!item.url)
    .map((item) => ({
      id: `open-${item.id}`,
      thumbUrl: item.thumbnail || item.url,
      fullUrl: item.url,
      width: item.width ?? 0,
      height: item.height ?? 0,
      credit: item.creator || item.title || 'Відкрита ліцензія',
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
  const trimmed = query.trim();
  const path = trimmed
    ? `/v1/search?query=${encodeURIComponent(trimmed)}&per_page=30&page=${page}&orientation=square`
    : `/v1/curated?per_page=30&page=${page}`;
  const response = await fetch(`https://api.pexels.com${path}`, { headers: { Authorization: key } });
  if (response.status === 401) throw new Error('Ключ Pexels не підійшов');
  if (!response.ok) throw new Error(`Pexels відповів помилкою (${response.status})`);
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
