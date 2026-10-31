import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFileSystem from 'expo-file-system/legacy';

// THE FOLDER COVERS' PATTERNS AS PICTURES (2026-10-12). A cover's pattern is ~260 icons, ~800 vector shapes: the
// phone had to build them and draw them again on every frame of a folder's opening - the user felt it at once
// («фон без патерна плавний, як ніби фарбу розлили... а з патерном ніби лук натягують і він вистрелює»). So each
// pattern is drawn as shapes ONCE, photographed (react-native-view-shot), and from then on shown as one picture -
// as cheap to grow as a plain colour. Kept for the session; the key names everything the drawing depends on.

const shots = new Map<string, string>();
const listeners = new Set<() => void>();
const taking = new Set<string>();

// KEPT BETWEEN RUNS (optimisation evening, 2026-10-22): kept for the session only, every first opening of a folder after
// a start drew the ~800 shapes again and photographed them - measured on the phone, 330 ms of JS stalls on the first
// opening against 70 ms on the next ones. The pictures are copied out of the cache into the app's own folder and listed
// in AsyncStorage (the desks' pictures do the same, navigation/deskShots), so a cover is a picture from its first frame.
const INDEX_KEY = 'mindeva.patternShots.v1';
const DIR = LegacyFileSystem.documentDirectory ? `${LegacyFileSystem.documentDirectory}patternShots/` : null;
// The covers a person has are few; the keys change with a folder's size and contents, so old ones are let go.
const KEEP = 80;
const kept = new Map<string, string>();

function fileNameOf(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i += 1) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return `p${(h >>> 0).toString(36)}_${key.length}.png`;
}

function saveIndex() {
  AsyncStorage.setItem(INDEX_KEY, JSON.stringify(Object.fromEntries(kept))).catch(() => {});
}

// The pictures kept from the last run - only those whose file is still there (the phone may clear an app's storage).
if (DIR) {
  AsyncStorage.getItem(INDEX_KEY)
    .then(async (raw) => {
      const index = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      const entries = Object.entries(index);
      const alive = await Promise.all(
        entries.map(([, uri]) =>
          LegacyFileSystem.getInfoAsync(uri)
            .then((info) => info.exists)
            .catch(() => false)
        )
      );
      entries.forEach(([key, uri], i) => {
        if (!alive[i]) return;
        kept.set(key, uri);
        if (!shots.has(key)) shots.set(key, uri);
      });
      if (alive.some((a) => !a)) saveIndex();
      listeners.forEach((l) => l());
    })
    .catch(() => {});
}

function keep(key: string, tmp: string) {
  if (!DIR) return;
  const target = `${DIR}${fileNameOf(key)}`;
  LegacyFileSystem.makeDirectoryAsync(DIR, { intermediates: true })
    .catch(() => undefined)
    .then(() => LegacyFileSystem.copyAsync({ from: tmp, to: target }))
    .then(() => {
      kept.delete(key);
      kept.set(key, target);
      // The oldest go first once there are too many.
      while (kept.size > KEEP) {
        const [oldKey, oldUri] = kept.entries().next().value as [string, string];
        kept.delete(oldKey);
        LegacyFileSystem.deleteAsync(oldUri, { idempotent: true }).catch(() => {});
      }
      saveIndex();
    })
    .catch(() => {});
}

export function patternShot(key: string): string | undefined {
  return shots.get(key);
}

export function putPatternShot(key: string, uri: string): void {
  shots.set(key, uri);
  taking.delete(key);
  listeners.forEach((l) => l());
  keep(key, uri);
}

// Whether a photograph of this key is already being taken (only one per key).
export function claimPatternShot(key: string): boolean {
  if (shots.has(key) || taking.has(key)) return false;
  taking.add(key);
  return true;
}

export function releasePatternClaim(key: string): void {
  taking.delete(key);
}

export function usePatternShot(key: string | null): string | undefined {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!key || shots.has(key)) return;
    const listener = () => {
      if (shots.has(key)) bump((n) => n + 1);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [key]);
  return key ? shots.get(key) : undefined;
}
