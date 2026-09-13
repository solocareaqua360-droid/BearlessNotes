// Which of the three link "databases" a link belongs to. The one `links`
// collection holds every kind, and this is what splits it back into three
// separate-looking databases without three separate collections - it
// matches the exact siteName values fetchLinkPreview stamps on conversion
// (see DocumentEditorScreen).
//
// Its own module because the search reads the same split: one place, so a
// new site name can never mean one thing on the links screen and another
// in the results.
export type LinkCategory = 'video' | 'geo' | 'other';

export function categoryFromSiteName(siteName?: string): LinkCategory {
  const s = siteName ?? '';
  if (s.includes('YouTube') || s.includes('TikTok')) return 'video';
  if (s === 'Геоточка') return 'geo';
  return 'other';
}
