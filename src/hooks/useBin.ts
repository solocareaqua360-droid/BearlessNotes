import { useEffect, useRef } from 'react';
import { deleteField, doc, updateDoc } from '../firestore';
import { db } from '../firebase';
import { ask, confirm } from '../components/surfaces/Ask';

export const BIN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// The 30-day bin DocumentsScreen already has, generalised for Photos/
// Files/Links: "delete" stamps deletedAt and the record drops out of
// every list, but nothing it carries (tags, group, references from other
// records) is touched until it is actually purged - by hand from the
// bin, or by time. Restoring undoes exactly the one stamp, so whatever
// was already true (its tags, its folder) is still true.
//
// purgeItem does the real, permanent cleanup - it varies per database
// (which tags to detach, which other records to update), so it stays
// the caller's own function; this hook only decides WHEN to call it.
//
// `trashed` is already split out of the screen's own snapshot handler
// (same shape as DocumentsScreen's own documents/trashed split) - sorted
// newest-deleted-first, and every item in it already has deletedAt set.
export function useBin<T extends { id: string; deletedAt?: number }>(
  collectionName: string,
  trashed: T[],
  purgeItem: (item: T) => Promise<void>
) {
  // Once per record per session, so a slow write does not get asked for
  // twice - same guard DocumentsScreen's own bin uses.
  const purgedRef = useRef(new Set<string>());
  const trashedKey = trashed.map((item) => `${item.id}:${item.deletedAt}`).join(',');
  useEffect(() => {
    const cutoff = Date.now() - BIN_TTL_MS;
    trashed.forEach((item) => {
      if ((item.deletedAt ?? 0) < cutoff && !purgedRef.current.has(item.id)) {
        purgedRef.current.add(item.id);
        purgeItem(item).catch(() => {});
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trashedKey]);

  async function moveToBin(id: string) {
    await updateDoc(doc(db, collectionName, id), { deletedAt: Date.now() });
  }

  async function restore(id: string) {
    await updateDoc(doc(db, collectionName, id), { deletedAt: deleteField() });
  }

  // Held down in the bin: back, or away for good - same two choices
  // everywhere this hook is used.
  async function openTrashMenu(item: T, title: string) {
    const choice = await ask({
      title,
      actions: [
        { id: 'restore', label: 'Відновити', icon: 'arrow-undo-outline', tone: 'primary' },
        { id: 'purge', label: 'Видалити назавжди', icon: 'trash-outline', tone: 'danger' },
      ],
    });
    if (choice === 'restore') await restore(item.id);
    if (choice === 'purge') await purgeItem(item);
  }

  async function emptyBin(labelGenitive: string) {
    if (trashed.length === 0) return;
    const yes = await confirm({
      title: `Очистити кошик (${trashed.length})?`,
      message: `Ці ${labelGenitive} буде видалено назавжди.`,
      confirmLabel: 'Очистити',
    });
    if (!yes) return;
    await Promise.all(trashed.map((item) => purgeItem(item)));
  }

  return { trashed, moveToBin, restore, openTrashMenu, emptyBin };
}
