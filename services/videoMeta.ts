import { VideoSource } from "@/types";

export interface VideoMeta {
  title: string;
  thumbnailUrl: string;
  durationSec: number;
  source: VideoSource;
}

function detectSource(url: string): VideoSource {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/tiktok\.com/i.test(url)) return "tiktok";
  return "unknown";
}

function extractYoutubeId(url: string): string | null {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/
  );
  return match ? match[1] : null;
}

/**
 * Fetches display metadata for a pasted video link.
 *
 * v1 stub: derives a real YouTube thumbnail from the video id when possible
 * and falls back to placeholder data otherwise. A later pass swaps this for
 * YouTube oEmbed / TikTok oEmbed calls without changing the call signature.
 */
export async function fetchVideoMeta(url: string): Promise<VideoMeta> {
  const source = detectSource(url);

  if (source === "youtube") {
    const id = extractYoutubeId(url);
    if (id) {
      return {
        title: "Нове відео з YouTube",
        thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
        durationSec: 0,
        source,
      };
    }
  }

  return {
    title: source === "tiktok" ? "Нове відео з TikTok" : "Нове відео",
    thumbnailUrl: "",
    durationSec: 0,
    source,
  };
}
