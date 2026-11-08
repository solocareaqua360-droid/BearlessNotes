import { getAccessToken } from "./googleAuth";

// THE OFFICIAL WAY, with the user's Google sign-in: their subscriptions, and each
// channel's latest uploads. Every call here costs 1 unit of the day's 10 000.
const BASE = "https://www.googleapis.com/youtube/v3";

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Потрібен вхід через Google");
  const res = await fetch(`${BASE}/${path}?${new URLSearchParams(params).toString()}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let reason = `YouTube відповів ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) reason = body.error.message;
    } catch {
      // keep the status text
    }
    throw new Error(reason);
  }
  return (await res.json()) as T;
}

export interface Subscription {
  channelId: string;
  title: string;
  avatarUrl?: string;
}

/** Every channel the user is subscribed to (paged, 50 at a time). */
export async function listSubscriptions(): Promise<Subscription[]> {
  const out: Subscription[] = [];
  let pageToken = "";
  for (let i = 0; i < 20; i++) {
    const data = await get<{
      nextPageToken?: string;
      items: { snippet: { title: string; resourceId: { channelId: string }; thumbnails?: { default?: { url: string } } } }[];
    }>("subscriptions", { part: "snippet", mine: "true", maxResults: "50", order: "alphabetical", ...(pageToken ? { pageToken } : {}) });
    for (const it of data.items ?? []) {
      out.push({ channelId: it.snippet.resourceId.channelId, title: it.snippet.title, avatarUrl: it.snippet.thumbnails?.default?.url });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

export interface UploadedVideo {
  id: string;
  title: string;
  thumbnailUrl: string;
  publishedAt: number;
  durationSec?: number;
}

/** "PT1H2M10S" -> seconds. */
function isoSeconds(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

/** Lengths of videos in seconds (50 to a call, 1 unit each call). A video the API does not return is left out. */
export async function videoDurations(ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const data = await get<{ items: { id: string; contentDetails: { duration: string } }[] }>("videos", {
      part: "contentDetails",
      id: ids.slice(i, i + 50).join(","),
      maxResults: "50",
    });
    for (const it of data.items ?? []) out[it.id] = isoSeconds(it.contentDetails.duration);
  }
  return out;
}

/** A channel's latest uploads: its «uploads» playlist is its id with UC changed to UU. */
export async function latestUploads(channelId: string, max = 15): Promise<UploadedVideo[]> {
  const data = await get<{
    items: { contentDetails: { videoId: string; videoPublishedAt?: string }; snippet: { title: string; publishedAt: string } }[];
  }>("playlistItems", { part: "snippet,contentDetails", playlistId: `UU${channelId.slice(2)}`, maxResults: String(max) });
  const rows = (data.items ?? []).filter((it) => it.snippet.title !== "Private video" && it.snippet.title !== "Deleted video");
  // One more call for the lengths: it is how Shorts are told apart. If it fails, the videos still come, without lengths.
  const lengths = await videoDurations(rows.map((it) => it.contentDetails.videoId)).catch(() => ({}) as Record<string, number>);
  return rows.map((it) => ({
      durationSec: lengths[it.contentDetails.videoId],
      id: it.contentDetails.videoId,
      title: it.snippet.title,
      thumbnailUrl: `https://i.ytimg.com/vi/${it.contentDetails.videoId}/hqdefault.jpg`,
      publishedAt: Date.parse(it.contentDetails.videoPublishedAt ?? it.snippet.publishedAt) || Date.now(),
    }));
}
