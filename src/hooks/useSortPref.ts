import { useEffect, useState } from 'react';
import {
  doc,
  onSnapshot,
} from '../firestore';
import { setDoc } from '../utils/owned';
import { db } from '../firebase';
import { DEFAULT_SORT_PREF, SortField, SortPref, defaultDirFor } from '../utils/sortItems';
import { listenError } from '../utils/listenError';

// Persists the chosen sort field/direction to the screen's own
// `settings/<settingsKey>` doc (the same singleton-doc pattern as
// calendarPrefs/documentsPrefs/databaseTileColors) - tapping an already-
// selected field flips its direction, tapping a different one switches to
// it with that field's own sensible default direction.
export function useSortPref(settingsKey: string) {
  const [sortPref, setSortPrefState] = useState<SortPref>(DEFAULT_SORT_PREF);

  useEffect(() => {
    return onSnapshot(doc(db, 'settings', settingsKey), (snapshot) => {
      const data = snapshot.data();
      if (data?.sortField) {
        setSortPrefState({ field: data.sortField, dir: data.sortDir ?? defaultDirFor(data.sortField) });
      }
    }, listenError('useSortPref:settings'));
  }, [settingsKey]);

  function selectSortField(field: SortField) {
    const nextDir = sortPref.field === field ? (sortPref.dir === 'asc' ? 'desc' : 'asc') : defaultDirFor(field);
    setDoc(doc(db, 'settings', settingsKey), { sortField: field, sortDir: nextDir }, { merge: true });
  }

  return { sortPref, selectSortField };
}
