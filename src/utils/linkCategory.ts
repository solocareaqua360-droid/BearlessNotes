import { Ionicons } from '@expo/vector-icons';

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

// What each of the three link databases looks like. Shared, because the
// cards are now drawn outside the links screen too - a geo point in a
// group's section on another screen must carry the same pin in the same
// green as it does at home.
export const LINK_CATEGORY_INFO: Record<
  LinkCategory,
  { title: string; icon: keyof typeof Ionicons.glyphMap; color: string; emptyHint: string }
> = {
  video: {
    title: 'YouTube / TikTok',
    icon: 'videocam-outline',
    color: '#EF4444',
    emptyHint: "Вставте посилання на YouTube або TikTok окремим абзацом у документі - картка з'явиться тут сама",
  },
  geo: {
    title: 'Геоточки',
    icon: 'location-outline',
    color: '#16A34A',
    emptyHint: "Вставте посилання на місце з Google Maps окремим абзацом у документі - воно з'явиться тут само",
  },
  other: {
    title: 'Посилання',
    icon: 'link-outline',
    color: '#14B8A6',
    emptyHint: "Вставте посилання окремим абзацом у будь-якому документі - картка з'явиться тут сама",
  },
};
