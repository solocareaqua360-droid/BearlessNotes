export type SortField = 'title' | 'createdAt' | 'updatedAt';
export type SortDir = 'asc' | 'desc';
export type SortPref = { field: SortField; dir: SortDir };

export const DEFAULT_SORT_PREF: SortPref = { field: 'updatedAt', dir: 'desc' };

// Alphabetical defaults to ascending (A→Z); the two date fields default to
// descending (newest first) - whichever direction is the useful first read
// for that field.
export function defaultDirFor(field: SortField): SortDir {
  return field === 'title' ? 'asc' : 'desc';
}

// Shared by every database screen (Documents/Tasks/Files/Photos/Links).
// `getCreatedAt` can return undefined - items saved before this field
// existed have no real creation time on record, so they fall back to their
// own updatedAt rather than sorting as if created at time zero.
export function sortItems<T>(
  items: T[],
  pref: SortPref,
  getTitle: (item: T) => string,
  getCreatedAt: (item: T) => number | undefined,
  getUpdatedAt: (item: T) => number
): T[] {
  const sorted = [...items].sort((a, b) => {
    if (pref.field === 'title') {
      return getTitle(a).localeCompare(getTitle(b), 'uk', { sensitivity: 'base', numeric: true });
    }
    const av = pref.field === 'createdAt' ? (getCreatedAt(a) ?? getUpdatedAt(a)) : getUpdatedAt(a);
    const bv = pref.field === 'createdAt' ? (getCreatedAt(b) ?? getUpdatedAt(b)) : getUpdatedAt(b);
    return av - bv;
  });
  return pref.dir === 'desc' ? sorted.reverse() : sorted;
}
