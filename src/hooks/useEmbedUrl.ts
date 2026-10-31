import { useEffect, useState } from 'react';
import { getVideoEmbedInfo } from '../utils/videoEmbed';

// The address a video should be embedded from, for a browser's iframe.
//
// A TikTok share link (vt.tiktok.com/…, vm.tiktok.com/…) has no video id
// in it, so getVideoEmbedInfo can only hand back the link itself. A
// WebView takes that (it opens TikTok's own page), but an iframe cannot:
// TikTok's page refuses to be framed and the card stays black. The id is
// behind the redirect, and TikTok's oEmbed answer carries it (the same
// call the link preview already makes) - so it is asked here, once per
// link, and the minimal embed player is built from it.
const resolved = new Map<string, string>();

async function tikTokEmbedFor(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const id = String(data?.html ?? '').match(/data-video-id="(\d+)"/)?.[1] ?? data?.embed_product_id;
    return id ? `https://www.tiktok.com/embed/v2/${id}` : null;
  } catch {
    return null;
  }
}

export function useEmbedUrl(url: string | null): string | null {
  const info = url ? getVideoEmbedInfo(url) : null;
  const needsResolving = !!url && !!info && info.provider === 'tiktok' && info.embedUrl === url;
  const [found, setFound] = useState<string | null>(url ? (resolved.get(url) ?? null) : null);

  useEffect(() => {
    if (!url || !needsResolving) return;
    const known = resolved.get(url);
    if (known) {
      setFound(known);
      return;
    }
    let live = true;
    tikTokEmbedFor(url).then((embed) => {
      // Not found: the raw link, which at least opens TikTok's own page
      // wherever a frame is allowed to show it.
      const answer = embed ?? url;
      resolved.set(url, answer);
      if (live) setFound(answer);
    });
    return () => {
      live = false;
    };
  }, [url, needsResolving]);

  if (!info) return null;
  return needsResolving ? found : info.embedUrl;
}
