import { ComponentType, createContext, useCallback, useEffect, useState } from 'react';
import { Ionicons } from '../components/icons/Ionicons';
import { doc, onSnapshot } from '../firestore';
import { setDoc } from '../utils/owned';
import { db } from '../firebase';
import { GRID_TILES, WIDE_TILES } from '../constants/databaseTiles';
import { CustomDatabase } from '../types';
import { listenError } from '../utils/listenError';

// THE DESKS ARE DATABASES - the user's iOS model (2026-09-28): the app
// starts on a desk, a desk is a database open full screen, and there are
// up to four of them. «Документи» is always the first and cannot be
// closed; the rest are the user's own, dragged out of the databases'
// layer. The calendar lives left of the first desk, the databases right
// of the last - neither is a desk any more.
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
export const DEFAULT_DESKS = [START_DESK, PERMANENT_DESK, BOARDS_DESK];
// How many desks of databases (the documents included) there can be.
export const MAX_DESKS = 4;

const desksDoc = doc(db, 'settings', 'desks');

// The desks, kept in the account's settings - the same place every
// database keeps its own preferences.
export function useDesks() {
  const [desks, setDesksState] = useState<string[]>(DEFAULT_DESKS);
  useEffect(
    () =>
      onSnapshot(
        desksDoc,
        (snapshot) => {
          const stored = snapshot.data()?.keys as string[] | undefined;
          if (!stored || stored.length === 0) return;
          // The start desk, then the documents, whatever was stored.
          setDesksState([START_DESK, PERMANENT_DESK, ...stored.filter((k) => k !== PERMANENT_DESK && k !== START_DESK)].slice(0, MAX_DESKS + 1));
        },
        listenError('useDesks:desks')
      ),
    []
  );
  const setDesks = useCallback((next: string[]) => {
    const clean = [PERMANENT_DESK, ...next.filter((k) => k !== PERMANENT_DESK && k !== START_DESK)].slice(0, MAX_DESKS);
    setDesksState([START_DESK, ...clean]);
    // Stored without the start desk (see START_DESK).
    setDoc(desksDoc, { keys: clean }, { merge: true });
  }, []);
  return { desks, setDesks };
}

// The key a database tile becomes when it is made a desk.
export function deskKeyForTile(tileKey: string): string {
  if (tileKey === 'documents') return PERMANENT_DESK;
  if (tileKey === 'board') return BOARDS_DESK;
  return `db:${tileKey}`;
}

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
export const DeskContext = createContext<{ back: (() => void) | null } | null>(null);

// Which databases can stand as a desk, and what draws them. The
// registries (tags, projects, the chat) are not lists of records and stay
// where they are.
export type DeskScreen = { component: ComponentType<any>; props?: Record<string, unknown> };

// The desks and how to change them, for the bar that draws them (its ✕
// closes the desk in front) and the databases' layer (a tile dragged out
// of it becomes one).
export const DesksControlContext = createContext<{
  desks: string[];
  setDesks: (next: string[]) => void;
} | null>(null);

// Whether a key can stand as a desk at all - the same list deskScreenFor
// draws (tabScreens), without importing a single screen: the databases'
// own screen asks this, and importing the screens from there would be a
// cycle back into itself.
const DESKABLE = new Set([
  PERMANENT_DESK,
  BOARDS_DESK,
  'db:tasks',
  'db:photos',
  'db:files',
  'db:stickers',
  'db:flashcards',
  'db:diary',
  'db:geo',
  'db:links',
  'db:video',
]);

export function canBeDesk(key: string): boolean {
  return DESKABLE.has(key) || key.startsWith('db:custom:');
}
