// CHANNELS WITHOUT A KEY: a channel's «Відео» page carries the channel's id and
// its latest videos inside the page itself (ytInitialData). YouTube's RSS feeds
// answer 404 now, and the official API wants a Google sign-in (planned: it will
// feed the same store). This reads the page - it can break when YouTube changes
// the page, so every step fails soft.
export interface RawVideo {
  id: string;
  title: string;
  thumbnailUrl: string;
  publishedAt: number;
}

export interface LoadedChannel {
  id: string;
  name: string;
  avatarUrl?: string;
  videos: RawVideo[];
}

const HEADERS = { "Accept-Language": "uk" };

// "4 дн. тому", "2 тиж. тому", "3 міс. тому", "1 рік тому", "5 год. тому", and the English forms.
function ageToMs(text: string | undefined): number {
  if (!text) return 0;
  const m = text.match(/(\d+)\s*([^\d\s.]+)/);
  if (!m) return 0;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  const H = 3600000;
  const D = 24 * H;
  if (/^(хв|min)/.test(u)) return n * 60000;
  if (/^(год|hour|hr)/.test(u)) return n * H;
  if (/^(дн|день|day)/.test(u)) return n * D;
  if (/^(тиж|week)/.test(u)) return n * 7 * D;
  if (/^(міс|month)/.test(u)) return n * 30 * D;
  if (/^(р|рок|рік|рок|year|yr)/.test(u)) return n * 365 * D;
  return 0;
}

function pageUrlFor(input: string): string | Promise<string> {
  const text = input.trim();
  const id = text.match(/(UC[\w-]{22})/)?.[1];
  if (id) return `https://www.youtube.com/channel/${id}/videos`;
  const handle = text.match(/youtube\.com\/(@[\w.\-]+)/i)?.[1] ?? (text.startsWith("@") ? text.split(/[\s/?]/)[0] : null);
  if (handle) return `https://www.youtube.com/${handle}/videos`;
  if (/youtu\.be\/|youtube\.com\/(watch|shorts)/i.test(text)) {
    // A video link: its author is the channel.
    return fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(text)}&format=json`)
      .then((r) => r.json())
      .then((d: { author_url?: string }) => {
        if (!d.author_url) throw new Error("no author");
        return `${d.author_url}/videos`;
      });
  }
  return `https://www.youtube.com/@${text.replace(/^@/, "").replace(/\s+/g, "")}/videos`;
}

export async function loadChannel(input: string): Promise<LoadedChannel> {
  const url = await pageUrlFor(input);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`YouTube відповів ${res.status}`);
  const html = await res.text();
  const id = (html.match(/"channelId":"(UC[\w-]{22})"/) ?? html.match(/"externalId":"(UC[\w-]{22})"/) ?? html.match(/channel_id=(UC[\w-]{22})/))?.[1];
  if (!id) throw new Error("Не знайшов такого каналу");
  const name = decode(html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? "Канал");
  const avatarUrl = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];

  const videos: RawVideo[] = [];
  const m = html.match(/var ytInitialData = (\{.+?\});<\/script>/s);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const now = Date.now();
      const walk = (n: any) => {
        if (!n || typeof n !== "object") return;
        const l = n.lockupViewModel;
        if (l && l.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" && l.contentId) {
          const meta = l.metadata?.lockupMetadataViewModel;
          const parts: string[] = (meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts ?? []).map((p: any) => p?.text?.content);
          const age = parts.find((p) => /тому|ago/i.test(p ?? ""));
          videos.push({
            id: l.contentId,
            title: meta?.title?.content ?? "Відео",
            thumbnailUrl: `https://i.ytimg.com/vi/${l.contentId}/hqdefault.jpg`,
            publishedAt: now - ageToMs(age),
          });
        }
        for (const k in n) walk(n[k]);
      };
      walk(data);
    } catch {
      // The page changed shape: the channel is still added, with no videos.
    }
  }
  return { id, name, avatarUrl, videos };
}

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
