import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { setDoc } from '../utils/owned';
import { listenError } from '../utils/listenError';
import { navigationRef } from '../navigationRef';
import { GRID_TILES, WIDE_TILES, openDatabaseTile } from '../constants/databaseTiles';

// «ОБРАНІ БАЗИ» ON THE START (2026-10-28, the user: «на екран старт можна додати обрані бази… внизу»): the bases put on the
// start desk from a base's hold menu («На Старт»), in the order they were put there. Kept in the account's settings, so the
// phone and the laptop show the same ones. A key is a base's desk key: `db:<tile>` for a built-in base, `db:custom:<id>`
// for one of the user's own (navigation/desks' deskFace names and draws both).
const startBasesDoc = doc(db, 'settings', 'startBases');

let current: string[] = [];
const listeners = new Set<(keys: string[]) => void>();
let stop: (() => void) | null = null;
function listen() {
  if (stop) return;
  stop = onSnapshot(
    startBasesDoc,
    (snapshot) => {
      const stored = snapshot.data()?.items as string[] | undefined;
      current = Array.isArray(stored) ? stored.filter((k) => typeof k === 'string') : [];
      listeners.forEach((l) => l(current));
    },
    listenError('startBases')
  );
}

export function useStartBases(): { keys: string[]; isOn: (key: string) => boolean; toggle: (key: string) => void } {
  const [keys, setKeys] = useState<string[]>(current);
  useEffect(() => {
    listeners.add(setKeys);
    listen();
    setKeys(current);
    return () => {
      listeners.delete(setKeys);
    };
  }, []);
  const isOn = useCallback((key: string) => keys.includes(key), [keys]);
  const toggle = useCallback((key: string) => {
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    current = next;
    listeners.forEach((l) => l(next));
    setDoc(startBasesDoc, { items: next }, { merge: true }).catch(() => {});
  }, []);
  return { keys, isOn, toggle };
}

// Opens a base from its key: as its desk when it stands as one, otherwise its own screen.
export function openStartBase(key: string, desks: string[] | undefined): void {
  if (!navigationRef.isReady()) return;
  const navigate = navigationRef.navigate as (name: string, p?: unknown) => void;
  if (desks?.includes(key)) {
    navigate('Tabs', { screen: key });
    return;
  }
  if (key.startsWith('db:custom:')) {
    navigate('CustomDatabase', { databaseId: key.slice('db:custom:'.length) });
    return;
  }
  const tile = [...WIDE_TILES, ...GRID_TILES].find((t) => t.key === key.slice('db:'.length));
  if (tile) openDatabaseTile(navigationRef as never, tile);
}
