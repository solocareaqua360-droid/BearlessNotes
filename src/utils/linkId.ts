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
