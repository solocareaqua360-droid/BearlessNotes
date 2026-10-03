import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// WHAT WAS OPENED LATELY, on this device only: a document, a board, a file,
// a database - newest first. The start desk's «Нещодавні». Kept in the
// phone's own storage (it opens instantly and works offline), not in the
// account: what was opened on the laptop is the laptop's own list
// (navigation/desktopTabs).
export type RecentKind = 'document' | 'board' | 'file' | 'database';
export type RecentPlace = { kind: RecentKind; ref: string; at: number };

const KEY = 'mindeva.phone.recentPlaces';
const MAX = 30;

let recent: RecentPlace[] = [];
const listeners = new Set<() => void>();

// What was kept before this run, with whatever has been opened since the
// app started in front of it.
AsyncStorage.getItem(KEY)
  .then((raw) => {
    const kept = raw ? (JSON.parse(raw) as RecentPlace[]) : [];
    if (!Array.isArray(kept)) return;
    const fresh = recent;
    recent = [...fresh, ...kept.filter((k) => !fresh.some((f) => f.kind === k.kind && f.ref === k.ref))].slice(0, MAX);
    listeners.forEach((l) => l());
  })
  .catch(() => {});

export function noteOpened(kind: RecentKind, ref: string): void {
  if (!ref) return;
  if (recent[0]?.kind === kind && recent[0]?.ref === ref) return;
  recent = [{ kind, ref, at: Date.now() }, ...recent.filter((r) => !(r.kind === kind && r.ref === ref))].slice(0, MAX);
  AsyncStorage.setItem(KEY, JSON.stringify(recent)).catch(() => {});
  listeners.forEach((l) => l());
}

export function useRecentPlaces(): RecentPlace[] {
  const [value, setValue] = useState(recent);
  useEffect(() => {
    const listener = () => setValue(recent);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}

// For a screen: this thing is open (while it is the one in front).
export function useNoteOpened(kind: RecentKind, ref: string | undefined, enabled = true) {
  useEffect(() => {
    if (enabled && ref) noteOpened(kind, ref);
  }, [kind, ref, enabled]);
}
