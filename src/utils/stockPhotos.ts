import { getPexelsKey } from './pexelsKey';

// A free picture library to pull tile backgrounds from, the way Notion's
// own cover picker reaches into Unsplash. Pexels rather than Unsplash: no
// attribution is required by its licence (Unsplash's does), the free tier
// is generous (200 requests an hour), and signing up for a key takes a
// minute at pexels.com/api - no application to review.
//
// This module only ever reads. Nothing here uploads, deletes, or touches
// an account - a search is a GET with the user's own key on it.

export type StockPhoto = {
  id: number;
  // Small enough for a grid of results.
  thumbUrl: string;
  // Large enough to crop into a tile without turning to mush - Pexels'
  // own "large2x" size, capped well above anything a tile will ever be.
  fullUrl: string;
  width: number;
  height: number;
  photographer: string;
  // Where the picture actually lives, for whoever wants to look at it or
  // the person who took it - not shown as a legal requirement here, just
  // good manners toward the person who made the photo free to use.
  pageUrl: string;
};

export class StockPhotosNotConfigured extends Error {
  constructor() {
    super('Немає ключа Pexels');
  }
}

function toPhoto(raw: {
  id: number;
  width: number;
  height: number;
  photographer: string;
  url: string;
  src: { medium: string; large2x: string };
}): StockPhoto {
  return {
    id: raw.id,
    thumbUrl: raw.src.medium,
    fullUrl: raw.src.large2x,
    width: raw.width,
    height: raw.height,
    photographer: raw.photographer,
    pageUrl: raw.url,
  };
}

async function call(path: string): Promise<{ photos: StockPhoto[] }> {
  const key = await getPexelsKey();
  if (!key) throw new StockPhotosNotConfigured();
  const response = await fetch(`https://api.pexels.com${path}`, {
    headers: { Authorization: key },
  });
  if (response.status === 401) throw new Error('Ключ Pexels не підійшов');
  if (!response.ok) throw new Error(`Pexels відповів помилкою (${response.status})`);
  const data = (await response.json()) as { photos: unknown[] };
  return { photos: (data.photos as Parameters<typeof toPhoto>[0][]).map(toPhoto) };
}

// A query, or nothing for a general "give me something good" starting
// point - Pexels' own curated feed, the same idea as Notion's default
// grid before anyone has typed a word.
export async function searchStockPhotos(query: string, page = 1): Promise<StockPhoto[]> {
  const trimmed = query.trim();
  const path = trimmed
    ? `/v1/search?query=${encodeURIComponent(trimmed)}&per_page=30&page=${page}&orientation=square`
    : `/v1/curated?per_page=30&page=${page}`;
  const { photos } = await call(path);
  return photos;
}
