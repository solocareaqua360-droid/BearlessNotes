// Canonicalizing a URL before hashing is what makes the same video/page
// pasted in different forms (youtu.be/<id> vs youtube.com/watch?v=<id>, or
// the same link with different tracking params tacked on) converge onto ONE
// record in the `links` collection instead of a fresh one each time.
// Shared by DocumentEditorScreen (typing/pasting a link) and copyToNote.ts
// (the "copy to note" bulk action) so there is exactly one implementation
// to ever compute a link's mirror-record id - the two used to be separate
// copies of the same logic, which is exactly the kind of drift that lets a
// "should be the same record" link end up as two.
const LINK_TRACKING_PARAMS = [
  'si',
  'feature',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'ref',
  'ref_src',
  '_r',
  '_t',
  'is_from_webapp',
  'sender_device',
  'is_copy_url',
];

export function canonicalUrlForDedup(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      if (id) return `youtube:${id}`;
    }
    if (host === 'youtube.com') {
      const id = u.searchParams.get('v');
      if (id) return `youtube:${id}`;
    }
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
      const match = u.pathname.match(/\/video\/(\d+)/);
      if (match) return `tiktok:${match[1]}`;
    }
    LINK_TRACKING_PARAMS.forEach((p) => u.searchParams.delete(p));
    const query = u.searchParams.toString();
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${path}${query ? `?${query}` : ''}`;
  } catch {
    return url.trim();
  }
}

// A 32-bit hash is plenty for a personal notes app's link count; a doc id
// can't hold an arbitrary URL anyway (length/character limits).
export function linkDocId(url: string): string {
  const canonical = canonicalUrlForDedup(url);
  let hash = 5381;
  for (let i = 0; i < canonical.length; i++) {
    hash = (hash * 33) ^ canonical.charCodeAt(i);
  }
  return `link-${(hash >>> 0).toString(36)}`;
}


// THE ADDRESS AS A PROGRAM WANTS IT WHEN COPIED (2026-10-11: NotebookLM refused a link copied from the
// app, while the same video copied from YouTube itself was fine). What is STORED stays exactly what
// the share sheet gave (it also decides which record a link is - see canonicalUrlForDedup); only the
// text put on the clipboard is cleaned: a YouTube video becomes the plain
// https://www.youtube.com/watch?v=ID (the start time, if any, kept), without the `si=` and other
// tracking tail; anything else is only trimmed.
export function linkForCopy(url: string): string {
  const text = url.trim();
  try {
    const u = new URL(text);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] || null;
    else if (host === 'youtube.com') {
      id = u.searchParams.get('v');
      if (!id) {
        const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/);
        if (m) id = m[1];
      }
    }
    if (!id) return text;
    const t = u.searchParams.get('t') ?? u.searchParams.get('start');
    return `https://www.youtube.com/watch?v=${id}${t && /^\d+s?$/.test(t) ? `&t=${t.replace(/s$/, '')}s` : ''}`;
  } catch {
    return text;
  }
}
