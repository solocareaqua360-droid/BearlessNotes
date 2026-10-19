import { ComponentType, createContext, useCallback, useEffect, useState } from 'react';
import { Ionicons } from '../components/icons/Ionicons';
import { doc, onSnapshot } from '../firestore';
import { setDoc } from '../utils/owned';
import { db } from '../firebase';
import { GRID_TILES, WIDE_TILES } from '../constants/databaseTiles';
import { CustomDatabase } from '../types';
import { listenError } from '../utils/listenError';
import { FEATURES } from '../features';
import { threeDesksOnly } from './deskRegistry';

// THE DESKS ARE DATABASES - the user's iOS model (2026-09-28): the app
// starts on a desk, a desk is a database open full screen, and there are
// up to four of them. «Документи» is always the first and cannot be
// closed; the rest are the user's own. The calendar lives left of the
// first desk, the databases right of the last - neither is a desk any more.
//
// A desk's KEY is its tab's route name: the two the rest of the app
// already navigates to by name keep them («Документи», «Дошки»), every
// other database is `db:<tile key>` or `db:custom:<id>`.
export const PERMANENT_DESK = 'Документи';
export const BOARDS_DESK = 'Дошки';
// THE START DESK (2026-10-03): the first desk of the phone, ahead of the
// documents - recents, the way to the other desks and the drawers, and
// everything that can be made (screens/StartScreen). Always there, never
// closed, and NOT counted among the four: it is kept out of the stored
// list and put in front on read, so a build that does not know it still
// reads the same stored keys.
export const START_DESK = 'Старт';
// THE CALENDAR DESK (2026-10-12, the user's: «календар… другим екраном після провідника»): under
// features.calendarDesk the calendar stands right after the start desk, always, and the left layer keeps only
// the chat. Like the start desk it is never closed and never stored - put in place on read.
export const CALENDAR_DESK = 'Календар';
// The desks that are always there, in front of the user's own.
// THE BASES DESK (2026-10-12, the user's: «виносимо бази на головний екран, вони більше не в шторці»): under
// features.basesDesk the bases list is the third fixed desk and the right layer is gone.
export const BASES_DESK = 'Більше';
export const FIXED_DESKS = [
  START_DESK,
  ...(FEATURES.calendarDesk ? [CALENDAR_DESK] : []),
  ...(FEATURES.basesDesk ? [BASES_DESK] : []),
];
export const DEFAULT_DESKS = [...FIXED_DESKS, PERMANENT_DESK, BOARDS_DESK];
// There used to be four ("до чотирьох"); the user lifted it (2026-10-03,
// «зняти обмеження»): the bar scrolls, and the tab switcher shows them all.
export const MAX_DESKS = Infinity;

const desksDoc = doc(db, 'settings', 'desks');

// The desks, kept in the account's settings - the same place every
// database keeps its own preferences.
export function useDesks() {
  const [desks, setDesksState] = useState<string[]>(threeDesksOnly ? FIXED_DESKS : DEFAULT_DESKS);
  useEffect(
    () =>
      // Only the three desks: the stored extras are not read (nor written - they come back with the flag off).
      threeDesksOnly ? undefined : onSnapshot(
        desksDoc,
        (snapshot) => {
          const stored = snapshot.data()?.keys as string[] | undefined;
          // Nothing stored yet: the defaults. An EMPTY list is a choice
          // (every desk closed but the start).
          if (!stored) return;
          // The start desk first; the rest as stored - the documents are a
          // desk like the others now and may have been closed.
          // A database put away for now (features.ts) is not a desk either
          // (the next change of desks stores the list without it).
          setDesksState([...FIXED_DESKS, ...stored.filter((k) => !FIXED_DESKS.includes(k) && (FEATURES.stickers || k !== 'db:stickers'))]);
        },
        listenError('useDesks:desks')
      ),
    []
  );
  const setDesks = useCallback((next: string[]) => {
    if (threeDesksOnly) return;
    const clean = next.filter((k) => !FIXED_DESKS.includes(k));
    setDesksState([...FIXED_DESKS, ...clean]);
    // Stored without the start desk (see START_DESK).
    setDoc(desksDoc, { keys: clean }, { merge: true });
  }, []);
  return { desks, setDesks };
}

// The key a database of the user's own stands under as a desk.
export function deskKeyForCustom(databaseId: string): string {
  return `db:custom:${databaseId}`;
}

// What a desk looks like on the bar: its name and icon.
export function deskFace(
  key: string,
  customDatabases: CustomDatabase[],
  // The icon the user chose for a built-in database (useDatabaseTiles).
  iconFor?: (tileKey: string, fallback: string) => string
): { label: string; icon: keyof typeof Ionicons.glyphMap } {
  if (key === START_DESK) return { label: 'Старт', icon: 'home-outline' };
  if (key === CALENDAR_DESK) return { label: 'Календар', icon: 'calendar-outline' };
  if (key === BASES_DESK) return { label: 'Бази', icon: 'apps-outline' };
  if (key === PERMANENT_DESK) return { label: 'Документи', icon: 'document-text-outline' };
  if (key === BOARDS_DESK) return { label: 'Дошки', icon: 'easel-outline' };
  if (key.startsWith('db:custom:')) {
    const database = customDatabases.find((d) => d.id === key.slice('db:custom:'.length));
    return {
      label: database?.name || 'База',
      icon: (database?.icon as keyof typeof Ionicons.glyphMap | undefined) ?? 'grid-outline',
    };
  }
  const tile = [...WIDE_TILES, ...GRID_TILES].find((t) => `db:${t.key}` === key);
  return tile
    ? { label: tile.label, icon: (iconFor ? iconFor(tile.key, tile.icon) : tile.icon) as keyof typeof Ionicons.glyphMap }
    : { label: 'База', icon: 'grid-outline' };
}

// Told to a database drawn as a desk: it is not a screen pushed over
// anything, so it draws no bar of its own (the desks' bar is up) and its
// way back is the desk before it - or nowhere, on the first.
export const DeskContext = createContext<{ back: (() => void) | null; key?: string } | null>(null);

// Which databases can stand as a desk, and what draws them. The
// registries (tags, projects, the chat) are not lists of records and stay
// where they are.
export type DeskScreen = { component: ComponentType<any>; props?: Record<string, unknown> };

// The desks and how to change them, for the bar that draws them (its ✕
// closes the desk in front) and the start desk.
export const DesksControlContext = createContext<{
  desks: string[];
  setDesks: (next: string[]) => void;
} | null>(null);

export { ensureDesk, registerDesks, whenDeskIsThere } from './deskRegistry';
