import { useEffect, useState } from 'react';
import { doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { setDoc } from '../utils/owned';
import { listenError } from '../utils/listenError';

// «ОБРАНЕ» (2026-11-16, the user: «додати в обране будь який елемент баз включно з нотатками і дошками, і він би
// відображався в окремому пункті обране на стартовому екрані»). NOT the pins: a pin lifts a thing to the top of ITS list
// («закріплене потрібне для підняття вгорі списку»); a favourite also stands in «Обране» on the Start, and stays where
// it lives. One list for the account, so the phone and the Mac share it. Each entry is a FolderItem id
// (`${collection}:${docId}`), the newest first.
const favoritesDoc = doc(db, 'settings', 'favoriteItems');

let current: string[] = [];
const listeners = new Set<(ids: string[]) => void>();
let stop: (() => void) | null = null;
function listen() {
  if (stop) return;
  stop = onSnapshot(
    favoritesDoc,
    (snapshot) => {
      const stored = snapshot.data()?.items as unknown;
      current = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : [];
      listeners.forEach((l) => l(current));
    },
    listenError('favorites')
  );
}

export const favoriteId = (collection: string, docId: string) => `${collection}:${docId}`;

export function isFavorite(id: string): boolean {
  return current.includes(id);
}

export function toggleFavorite(id: string): boolean {
  listen();
  const was = current.includes(id);
  const next = was ? current.filter((x) => x !== id) : [id, ...current];
  current = next;
  listeners.forEach((l) => l(next));
  setDoc(favoritesDoc, { items: next }, { merge: true }).catch(() => {});
  return !was;
}

export function useFavorites(): string[] {
  const [ids, setIds] = useState<string[]>(current);
  useEffect(() => {
    listeners.add(setIds);
    listen();
    setIds(current);
    return () => {
      listeners.delete(setIds);
    };
  }, []);
  return ids;
}

// The row every base's own menu carries (its card menu or its hold menu): in or out of «Обране», by what it says now.
export function favoriteMenuRow(collection: string, docId: string, close?: () => void): { icon: string; label: string; onPress: () => void } {
  listen();
  const id = favoriteId(collection, docId);
  const on = isFavorite(id);
  return {
    icon: on ? 'star' : 'star-outline',
    label: on ? 'Прибрати з обраного' : 'В обране',
    onPress: () => {
      close?.();
      toggleFavorite(id);
    },
  };
}
