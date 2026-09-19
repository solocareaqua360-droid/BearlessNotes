// Extracted from DocumentEditorScreen (where a pasted bare URL auto-converts
// to a link block) so LinksScreen's own "+" button - creating a link record
// with no document at all - can fetch the exact same preview without
// duplicating this HTML/oEmbed parsing wholesale.
export type LinkPreview = { title?: string; imageUrl?: string; siteName?: string };

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
    return placeName ? { title: placeName, siteName: 'Геоточка' } : { siteName: 'Геоточка' };
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
