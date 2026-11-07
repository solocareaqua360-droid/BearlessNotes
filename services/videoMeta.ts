import { VideoSource } from "@/types";

export interface VideoMeta {
  title: string;
  thumbnailUrl: string;
  durationSec: number;
  source: VideoSource;
  /** "author · TikTok" (or just the platform when oEmbed gave no author). */
  siteName: string;
}

interface OEmbedResponse {
  title?: string;
  thumbnail_url?: string;
  author_name?: string;
}

function siteLabel(platform: string, author?: string): string {
  return author ? `${author} · ${platform}` : platform;
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

async function fetchOEmbed(oembedUrl: string): Promise<OEmbedResponse | null> {
  try {
    const response = await fetch(oembedUrl);
    if (!response.ok) return null;
    return (await response.json()) as OEmbedResponse;
  } catch {
    // No network, invalid/private link, or the provider is unreachable —
    // callers fall back to placeholder data in that case.
    return null;
  }
}

/**
 * Fetches display metadata (title + thumbnail) for a pasted video link via
 * each platform's public oEmbed endpoint — no API key needed. Duration is
 * not available through oEmbed for either platform, so it stays 0; getting
 * a real duration would require the YouTube Data API (and TikTok has no
 * public equivalent at all).
 */
export async function fetchVideoMeta(url: string): Promise<VideoMeta> {
  const source = detectSource(url);

  if (source === "youtube") {
    const id = extractYoutubeId(url);
    const fallbackThumbnail = id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : "";

    const data = await fetchOEmbed(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    );

    return {
      title: data?.title ?? "Нове відео з YouTube",
      thumbnailUrl: data?.thumbnail_url ?? fallbackThumbnail,
      durationSec: 0,
      source,
      siteName: siteLabel("YouTube", data?.author_name),
    };
  }

  if (source === "tiktok") {
    const data = await fetchOEmbed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);

    return {
      title: data?.title ?? "Нове відео з TikTok",
      thumbnailUrl: data?.thumbnail_url ?? "",
      durationSec: 0,
      source,
      siteName: siteLabel("TikTok", data?.author_name),
    };
  }

  return {
    title: "Нове відео",
    thumbnailUrl: "",
    durationSec: 0,
    source,
    siteName: "",
  };
}
