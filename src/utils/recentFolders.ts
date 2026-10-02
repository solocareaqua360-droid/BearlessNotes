import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// THE FOLDERS LAST PUT TO USE, across every database (the folders rework,
// step 2, 2026-10-02): folders are one set shared by photos, files, notes,
// links and records, and the quickest way to keep them from tangling is to
// offer the same few, in the same order, wherever something is being
// filed. useTags' attach and create note each use here; the strip over a
// selection (RecentFolderStrip) reads it.
const KEY = 'recentFolders.v1';
const MAX = 8;

let ids: string[] = [];
let loaded = false;
const listeners = new Set<(next: string[]) => void>();

function load() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((stored) => {
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        ids = parsed.filter((x) => typeof x === 'string').slice(0, MAX);
        listeners.forEach((l) => l(ids));
      }
    })
    .catch(() => {});
}

export function noteFolderUsed(tagId: string) {
  load();
  ids = [tagId, ...ids.filter((x) => x !== tagId)].slice(0, MAX);
  AsyncStorage.setItem(KEY, JSON.stringify(ids)).catch(() => {});
  listeners.forEach((l) => l(ids));
}

export function useRecentFolderIds(): string[] {
  load();
  const [current, setCurrent] = useState(ids);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(ids);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);
  return current;
}
