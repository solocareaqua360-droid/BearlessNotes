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
    // youtube-nocookie.com (not youtube.com) - the privacy-enhanced embed
    // domain Google itself recommends for third-party embedding, and
    // noticeably less prone to the IFrame player's origin/referrer checks
    // rejecting a WebView-hosted embed (see VideoPlayerModal's baseUrl for
    // the other half of that fix). Falls back to the raw watch URL (still
    // opens in the WebView, just without the stripped-down embed player)
    // if the id couldn't be parsed out - better than refusing to show
    // anything.
    const embedUrl = id ? `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&autoplay=1` : url;
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

// TIMECODES (a note's "04:32" seeks its video): the YouTube embed takes
// commands through postMessage once it is loaded with enablejsapi=1 -
// checked against the live player, 2026-10-02: started at 0:30, told to
// seekTo 300, it reported 300. `start` is where a freshly mounted player
// begins, so the first tap needs no command at all.
export function youtubeEmbedAt(embedUrl: string, start?: number): string {
  const extra = `enablejsapi=1${start ? `&start=${Math.floor(start)}` : ''}`;
  return embedUrl.includes('?') ? `${embedUrl}&${extra}` : `${embedUrl}?${extra}`;
}

export function youtubeCommand(func: 'seekTo' | 'playVideo', args: unknown[] = []): string {
  return JSON.stringify({ event: 'command', func, args });
}

// "4:32", "04:32", "1:02:03" -> seconds; anything else -> null.
export function parseTimecode(text: string): number | null {
  const m = text.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [h, min, sec] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (sec > 59 || (m[1] && min > 59)) return null;
  return h * 3600 + min * 60 + sec;
}

export const TIMECODE_PATTERN = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g;
