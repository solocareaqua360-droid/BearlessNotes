// Extracted from DocumentEditorScreen (where a pasted bare URL auto-converts
// to a link block) so LinksScreen's own "+" button - creating a link record
// with no document at all - can fetch the exact same preview without
// duplicating this HTML/oEmbed parsing wholesale.
export type LinkPreview = { title?: string; imageUrl?: string; siteName?: string; geoLat?: number; geoLng?: number };

export function isMapsUrl(url: string): boolean {
  return /google\.[^/]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(url);
}
export function isYouTubeUrl(url: string): boolean {
  return /(youtube\.com\/watch|youtu\.be\/)/i.test(url);
}
export function isTikTokUrl(url: string): boolean {
  return /tiktok\.com\//i.test(url);
}

// Google Maps' own "Share" button embeds the place name right in the URL
// path (/maps/place/<name>/...) - reading it back out is free and needs no
// network call. A raw coordinates-only link (no /place/ segment) has no name
// to recover this way; reverse geocoding it would need a paid-tier Google
// API, so that case is left to fall back to a generic "Геоточка" label.
function extractMapsPlaceName(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/\/maps\/place\/([^/]+)/);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
  } catch {
    return null;
  }
}

// Coordinates already sitting in the URL's own text - free, no network,
// unlike the place NAME above never needing one either. Checked in order
// of how precise each shape actually is: `!3d<lat>!4d<lng>` is what
// Google embeds for the pinned point itself (present whenever the URL
// carries a `data=` segment, which a plain "Share" almost always does);
// `@lat,lng,zoom` is the map's own centre at share time - for a single
// point share that IS the point, but a link someone panned before
// copying could be off; `q=`/`query=` is the plain older shape.
function extractMapsCoordinatesFromText(url: string): { lat: number; lng: number } | null {
  const precise = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (precise) return { lat: Number(precise[1]), lng: Number(precise[2]) };
  const centre = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (centre) return { lat: Number(centre[1]), lng: Number(centre[2]) };
  try {
    const params = new URL(url).searchParams;
    const raw = params.get('q') ?? params.get('query');
    const match = raw?.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
    if (match) return { lat: Number(match[1]), lng: Number(match[2]) };
  } catch {
    // Not a URL Firestore/RN's URL can parse - no query string to read.
  }
  return null;
}

function isMapsShortLink(url: string): boolean {
  return /goo\.gl\/maps|maps\.app\.goo\.gl/i.test(url);
}

// A short "Share" link carries no coordinates of its own - only the long
// address it redirects to does. One plain fetch, following redirects the
// way `fetch` already does by default, reads that long address back from
// `res.url` - the same request a browser tab lands on, no API and no key.
async function resolveMapsShortLink(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    return res.url || null;
  } catch {
    return null;
  }
}

// A place Google itself RECOGNISES - an address, a business - shares
// with no coordinates in the URL at all, unlike a plain dropped pin: the
// `data=` segment carries an opaque place id
// (`!4m2!3m1!1s0x40dc...:0xc846...`), and turning that id back into a
// lat/lng needs a real Google lookup, the paid call this project has
// refused since extractMapsPlaceName's own first comment. What the URL
// DOES still carry is the place's readable name, and that can be
// geocoded for free through the same OpenStreetMap family already
// behind the map and its tiles: Nominatim, its own public search
// endpoint. One request per point, on demand - the same light-use trade
// already accepted for the tile server, never bulk geocoding.
// Match precision too coarse to trust for a single point - a street, a
// whole town, an administrative area. Confirmed on a real failing
// address: asked for "Глісерна вулиця, 14, Запоріжжя", Nominatim had no
// point for house 14 specifically and quietly answered with one
// somewhere along the whole street instead (`addresstype: "road"`, no
// `house_number` in the address it echoed back) - correct as far as it
// went, off by close to a kilometre as an actual pin. Silently wrong is
// worse than admittedly unknown, so a match at this level is refused
// the same way no match at all already is, rather than accepted as if
// it were as precise as a dropped pin's own coordinates.
const IMPRECISE_ADDRESS_TYPES = new Set([
  'road',
  'highway',
  'neighbourhood',
  'suburb',
  'city',
  'town',
  'village',
  'municipality',
  'county',
  'state',
  'country',
  'administrative',
  'postcode',
]);

async function geocodePlaceName(name: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1&addressdetails=1`,
      { headers: { 'User-Agent': 'BearlessNotes (mindEva notes app)' } }
    );
    if (!res.ok) return null;
    const results = (await res.json()) as { lat?: string; lon?: string; addresstype?: string }[];
    const first = results[0];
    if (!first?.lat || !first.lon) return null;
    if (first.addresstype && IMPRECISE_ADDRESS_TYPES.has(first.addresstype)) return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

// Coordinates for a Maps URL of any shape this app recognises - reading
// them straight out of the text where they are already there where a
// dropped pin put them, resolving a short link's one redirect where
// they are only reachable that way, and geocoding the place's own name
// as the last resort for a recognised address/business, whose URL never
// carries coordinates at all.
export async function extractMapsCoordinates(url: string): Promise<{ lat: number; lng: number } | null> {
  const direct = extractMapsCoordinatesFromText(url);
  if (direct) return direct;
  let resolvedUrl = url;
  if (isMapsShortLink(url)) {
    const resolved = await resolveMapsShortLink(url);
    if (resolved) {
      resolvedUrl = resolved;
      const fromResolved = extractMapsCoordinatesFromText(resolved);
      if (fromResolved) return fromResolved;
    }
  }
  const name = extractMapsPlaceName(resolvedUrl);
  return name ? geocodePlaceName(name) : null;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

async function fetchOEmbed(oembedUrl: string): Promise<LinkPreview | null> {
  try {
    const res = await fetch(oembedUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const preview: LinkPreview = {};
    if (data.title) preview.title = data.title;
    if (data.thumbnail_url) preview.imageUrl = data.thumbnail_url;
    if (data.author_name) preview.siteName = data.author_name;
    return preview;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractMetaTag(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtmlEntities(match[1]);
  }
  return null;
}

async function fetchOpenGraphPreview(url: string): Promise<LinkPreview | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const preview: LinkPreview = {};
    const title = extractMetaTag(html, 'og:title');
    const image = extractMetaTag(html, 'og:image');
    const siteName = extractMetaTag(html, 'og:site_name');
    if (title) preview.title = title;
    if (image) preview.imageUrl = image;
    if (siteName) preview.siteName = siteName;
    return Object.keys(preview).length > 0 ? preview : null;
  } catch {
    return null;
  }
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  if (isMapsUrl(url)) {
    const placeName = extractMapsPlaceName(url);
    const coords = await extractMapsCoordinates(url);
    return {
      ...(placeName ? { title: placeName } : {}),
      siteName: 'Геоточка',
      ...(coords ? { geoLat: coords.lat, geoLng: coords.lng } : {}),
    };
  }
  if (isYouTubeUrl(url)) {
    const oembed = await fetchOEmbed(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (oembed) return { ...oembed, siteName: oembed.siteName ? `${oembed.siteName} · YouTube` : 'YouTube' };
  }
  if (isTikTokUrl(url)) {
    const oembed = await fetchOEmbed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    if (oembed) return { ...oembed, siteName: oembed.siteName ? `${oembed.siteName} · TikTok` : 'TikTok' };
  }
  const og = await fetchOpenGraphPreview(url);
  if (og) return { ...og, siteName: og.siteName ?? hostnameOf(url) };
  return { siteName: hostnameOf(url) };
}
