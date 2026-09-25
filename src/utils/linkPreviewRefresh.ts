import { doc, updateDoc } from '../firestore';
import { db } from '../firebase';
import { extractMapsCoordinates, fetchLinkPreview } from './linkPreview';

// A link's picture, kept alive.
//
// A TikTok cover is not a picture, it is a signed URL with a deadline:
// `x-expires=<unix seconds>`, two or three days out from when it was
// fetched. Past that the CDN answers 403 to everyone, whatever the
// Referer. The app stored those URLs as if they were permanent, so every
// TikTok link older than a few days had a blank card - on the phone the
// image cache hid it for a while, in a browser it showed at once. (Found
// by curling the three stored URLs: all expired, all 403, with and
// without a Referer.)
//
// So a preview whose URL has run out is fetched again, through the same
// oEmbed the link was first previewed with - which TikTok serves with
// `access-control-allow-origin: *`, so the browser can do this itself -
// and only the picture is written back. Never the title: the user may
// have renamed the link. Never updatedAt: that would reorder the list.

// Reads the deadline out of the URL, or null for a URL that has none - a
// YouTube thumbnail is permanent and must never be refetched for this.
export function previewExpiresAt(imageUrl: string | undefined): number | null {
  if (!imageUrl) return null;
  const match = /[?&]x-expires=(\d{9,11})(?:&|$)/.exec(imageUrl);
  if (!match) return null;
  return Number(match[1]) * 1000;
}

export function previewExpired(imageUrl: string | undefined, now = Date.now()): boolean {
  const expiresAt = previewExpiresAt(imageUrl);
  // An hour early: a URL that dies while the page is open is the same
  // blank card, one reload later.
  return expiresAt !== null && expiresAt - 60 * 60 * 1000 < now;
}

// One attempt in flight per link, and a pause after a failed one - an
// oEmbed that answers nothing must not be asked again on every snapshot
// the listener delivers.
const inFlight = new Set<string>();
const lastFailure = new Map<string, number>();
const RETRY_AFTER_MS = 10 * 60 * 1000;

export async function refreshLinkPreviewIfExpired(link: {
  id: string;
  url: string | undefined;
  imageUrl: string | undefined;
}): Promise<void> {
  if (!link.url || !previewExpired(link.imageUrl)) return;
  if (inFlight.has(link.id)) return;
  const failedAt = lastFailure.get(link.id);
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return;

  inFlight.add(link.id);
  try {
    const preview = await fetchLinkPreview(link.url);
    if (!preview.imageUrl || preview.imageUrl === link.imageUrl || previewExpired(preview.imageUrl)) {
      lastFailure.set(link.id, Date.now());
      return;
    }
    await updateDoc(doc(db, 'links', link.id), { imageUrl: preview.imageUrl });
    lastFailure.delete(link.id);
  } catch {
    lastFailure.set(link.id, Date.now());
  } finally {
    inFlight.delete(link.id);
  }
}

// The same lazy backfill, for a geo point saved before extractMapsCoordinates
// existed - or whose short link had no network to resolve against at the
// time. Its own in-flight/backoff pair, keyed apart from the picture
// refresh above so the two never block each other for the same link.
const geoInFlight = new Set<string>();
const geoLastFailure = new Map<string, number>();

export async function backfillGeoCoordinatesIfMissing(link: {
  id: string;
  url: string | undefined;
  siteName: string | undefined;
  geoLat: number | undefined;
  geoLng: number | undefined;
}): Promise<void> {
  if (!link.url || link.siteName !== 'Геоточка') return;
  if (link.geoLat != null && link.geoLng != null) return;
  if (geoInFlight.has(link.id)) return;
  const failedAt = geoLastFailure.get(link.id);
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return;

  geoInFlight.add(link.id);
  try {
    const coords = await extractMapsCoordinates(link.url);
    if (!coords) {
      geoLastFailure.set(link.id, Date.now());
      return;
    }
    await updateDoc(doc(db, 'links', link.id), { geoLat: coords.lat, geoLng: coords.lng });
    geoLastFailure.delete(link.id);
  } catch {
    geoLastFailure.set(link.id, Date.now());
  } finally {
    geoInFlight.delete(link.id);
  }
}
