// URL-based (not siteName-based) video detection - works even for a link
// whose preview metadata was never fetched, and is the single source of
// truth both DocumentEditorScreen's link blocks and BoardScreen's link
// cards check before deciding "open the URL externally" vs "play it right
// here".
export type VideoEmbedInfo = { provider: 'youtube' | 'tiktok'; embedUrl: string };

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)([\w-]{11})/,
    /youtube\.com\/embed\/([\w-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractTikTokId(url: string): string | null {
  const match = url.match(/tiktok\.com\/@[\w.-]+\/video\/(\d+)/);
  return match ? match[1] : null;
}

export function getVideoEmbedInfo(url: string): VideoEmbedInfo | null {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
    const id = extractYouTubeId(url);
    // Falls back to the raw watch URL (still opens in the WebView, just
    // without the stripped-down embed player) if the id couldn't be
    // parsed out - better than refusing to show anything.
    const embedUrl = id ? `https://www.youtube.com/embed/${id}?playsinline=1&autoplay=1` : url;
    return { provider: 'youtube', embedUrl };
  }
  if (lower.includes('tiktok.com')) {
    const id = extractTikTokId(url);
    // A vm.tiktok.com short link or any URL shape this regex doesn't cover
    // has no id to build a stripped embed from - the WebView loads the
    // original URL instead, which still plays (just as TikTok's own page,
    // not the minimal embed player).
    const embedUrl = id ? `https://www.tiktok.com/embed/v2/${id}` : url;
    return { provider: 'tiktok', embedUrl };
  }
  return null;
}
