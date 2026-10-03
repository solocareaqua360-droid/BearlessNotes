import { useEffect, useState } from 'react';
import type { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { captureRef } from 'react-native-view-shot';
import { deskPull } from './deskPull';

// THE DESKS' PICTURES, for the panel of open desks (components/DeskSwitcher):
// what each open desk last looked like, as a small photograph.
//
// READY BEFORE THEY ARE ASKED FOR (2026-10-04: "прев'ю робляться в процесі
// із значною затримкою ... треба отримувати миттєве"). Three things make
// that so:
// - they are KEPT: copied out of the cache into the app's own folder and
//   listed in AsyncStorage, so after a restart every desk has its picture
//   from the first frame instead of a black card waiting for a visit;
// - they are taken AHEAD: every desk a few seconds after the app starts
//   (the pager keeps every desk mounted), the desk in front a moment after
//   it settles, and again the moment a pull begins - the panel opens on
//   the last picture and the fresh one replaces it without a gap;
// - the panel's cards stay mounted (hidden) so the pictures are already
//   decoded when it opens (DeskSwitcher), and drawn without a fade-in.
const nodes = new Map<string, View>();
const shots = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// v2: the pictures kept before the boards fix were dropped - a black one
// would otherwise have stayed on its card for ever (2026-10-04).
const INDEX_KEY = 'mindeva.deskShots.v2';
const DIR = LegacyFileSystem.documentDirectory ? `${LegacyFileSystem.documentDirectory}deskShots/` : null;
const busy = new Set<string>();
// TEMPORARY DIAGNOSTIC (2026-10-04, the boards desk photographing black):
// what happened on each desk's last capture - which view was used and
// whether it failed - shown small on the panel's card so a screenshot from
// the phone says which it is. Remove once the boards desk is solved.
export const captureNotes = new Map<string, string>();

// The pictures kept from the last run.
AsyncStorage.getItem(INDEX_KEY)
  .then((raw) => {
    const kept = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    Object.entries(kept).forEach(([key, uri]) => {
      if (!shots.has(key)) shots.set(key, uri);
    });
    notify();
  })
  .catch(() => {});

function saveIndex() {
  AsyncStorage.setItem(INDEX_KEY, JSON.stringify(Object.fromEntries(shots))).catch(() => {});
}

export function registerDeskNode(key: string, node: View | null) {
  if (node) nodes.set(key, node);
  else nodes.delete(key);
}

// A desk that is a navigator of its own (the boards: the list, then a
// board) photographs BLACK through its wrapper - react-native-screens draws
// its stack in a way a software snapshot does not see (2026-10-04). Such a
// desk's screens say which of their views is the picture instead; the one
// registered last (the screen in front) wins, and when it goes the one
// under it is used again.
const content = new Map<string, View[]>();
export function registerDeskContent(key: string, node: View): () => void {
  const list = content.get(key) ?? [];
  content.set(key, [...list.filter((n) => n !== node), node]);
  return () => {
    const left = (content.get(key) ?? []).filter((n) => n !== node);
    if (left.length) content.set(key, left);
    else content.delete(key);
  };
}
function nodeFor(key: string): View | undefined {
  const list = content.get(key);
  return (list && list[list.length - 1]) ?? nodes.get(key);
}

export async function captureDesk(key: string): Promise<void> {
  const node = nodeFor(key);
  if (!node || busy.has(key)) {
    if (!node) captureNotes.set(key, 'немає вузла');
    return;
  }
  busy.add(key);
  const via = content.get(key)?.length ? `вміст(${content.get(key)!.length})` : 'обгортка';
  try {
    const tmp = await captureRef(node, { format: 'jpg', quality: 0.6, result: 'tmpfile', width: 420 });
    let uri = tmp;
    if (DIR) {
      await LegacyFileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
      // A new name each time: an image already shown under the same address
      // would be drawn from its cache, the old picture.
      const safe = key.replace(/[^A-Za-z0-9_-]/g, (c) => c.charCodeAt(0).toString(16));
      uri = `${DIR}${safe}-${Date.now()}.jpg`;
      await LegacyFileSystem.moveAsync({ from: tmp, to: uri });
    }
    captureNotes.set(key, `ок · ${via} · ${new Date().toLocaleTimeString().slice(0, 8)}`);
    const old = shots.get(key);
    shots.set(key, uri);
    saveIndex();
    notify();
    if (old && old !== uri && DIR && old.startsWith(DIR)) LegacyFileSystem.deleteAsync(old, { idempotent: true }).catch(() => {});
  } catch (e) {
    // Keeps the last picture it had.
    captureNotes.set(key, `помилка · ${via} · ${String((e as Error)?.message ?? e).slice(0, 80)}`);
    notify();
  } finally {
    busy.delete(key);
  }
}

// Every desk there is, one after another - a little apart, so the work
// does not land on one frame.
export async function captureAllDesks(): Promise<void> {
  for (const key of Array.from(nodes.keys())) {
    await captureDesk(key);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// A closed desk's picture goes with it.
export function forgetDesk(key: string) {
  const old = shots.get(key);
  if (!shots.delete(key)) return;
  saveIndex();
  notify();
  if (old && DIR && old.startsWith(DIR)) LegacyFileSystem.deleteAsync(old, { idempotent: true }).catch(() => {});
}

export function useDeskShots(): Record<string, string> {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return Object.fromEntries(shots);
}

// KEPT FRESH, QUIETLY (option 2, 2026-10-04): the desk in front is
// photographed again a moment after it was last touched and has come to
// rest (a scroll's coast included), and every so often while it stands
// untouched (a list that changed on its own - a sync from the other
// device). Never while the panel is out or a pull is under way, and never
// a desk that is not in front.
let current: string | null = null;
let paused = false;
let quietTimer: ReturnType<typeof setTimeout> | null = null;
let lastTouch = 0;
const QUIET_MS = 1500;
const IDLE_EVERY_MS = 45000;

export function setCurrentDesk(key: string | null) {
  current = key;
}
export function setDeskCapturePaused(on: boolean) {
  paused = on;
}
function canCapture(key: string) {
  return key === current && !paused && deskPull.value < 0.02;
}

// Told by a desk's wrapper each time a touch on it ends.
export function noteDeskTouched(key: string) {
  lastTouch = Date.now();
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = setTimeout(() => {
    quietTimer = null;
    if (canCapture(key)) captureDesk(key);
  }, QUIET_MS);
}

setInterval(() => {
  if (!current || Date.now() - lastTouch < QUIET_MS * 2) return;
  if (canCapture(current)) captureDesk(current);
}, IDLE_EVERY_MS);
