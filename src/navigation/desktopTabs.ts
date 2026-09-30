import { useEffect, useState } from 'react';

// THE MAIN PANE'S TABS. What is open in the middle of the window, as tabs
// along its top - a note, a board, a database, or a whole section (the
// calendar, the boards list, the chat...). The documents list is the first
// tab, always, and is not stored here.
//
// They are what makes a screen taking the WHOLE pane bearable. Without
// them, opening one is falling into it: the only way back is «Назад», and
// the thing you were comparing it against is gone. With them you are not
// leaving, you are switching between things you have open - which is what
// every editor on a desktop does, and what Craft does in the screenshot
// this came from.
//
// A tab is a PLACE, not a live screen: switching to one navigates there.
// What a screen holds in its own state (scroll, a selection) is not kept.
//
// References only. A title is looked up live, so a note renamed anywhere is
// renamed on its tab.
// 'target': any other database screen (a links list, photos, files...) -
// ref is its PaneTarget as JSON (navigation/paneTarget).
// 'file': a file looked at in a tab (FileViewScreen) - ref is its id.
export type TabKind = 'note' | 'board' | 'database' | 'section' | 'start' | 'target' | 'file';
// `seq`: the refs a tab steps through with its arrows (see stepTab) - the
// notes of the folder it was opened from, the boards of the list, the days
// of the diary. Only a tab opened with «Відкрити в новій вкладці» has one.
export type Tab = { key: string; kind: TabKind; ref: string; seq?: string[] };

const STORAGE_KEY = 'mindeva.desktopTabs';

// IN THE MAC APP the row is kept in a file the shell writes whole
// (/__desktop/state - see desktop/main.js), not only in localStorage, which
// came back older after some relaunches. Read synchronously, once, at start -
// the row is drawn from it on the first frame. localStorage stays as the
// browser's own keep and the fallback.
export function inShell(): boolean {
  try {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('desktop') === '1';
  } catch {
    return false;
  }
}

export function readShellState(key: string): string | null {
  if (!inShell()) return null;
  try {
    const request = new XMLHttpRequest();
    request.open('GET', `/__desktop/state/${key}`, false);
    request.send();
    return request.status === 200 ? request.responseText : null;
  } catch {
    return null;
  }
}

export function writeShellState(key: string, json: string): void {
  if (!inShell()) return;
  try {
    fetch(`/__desktop/state/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(() => {});
  } catch {
    // The next change writes it again.
  }
}

function load(): Tab[] {
  try {
    const raw =
      readShellState('desktopTabs') ?? (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null);
    const parsed = raw ? (JSON.parse(raw) as Tab[]) : [];
    // The start page is never brought back from a restart: it is a moment,
    // not a place.
    return Array.isArray(parsed) ? parsed.filter((t) => t && typeof t.key === 'string' && t.kind !== 'start') : [];
  } catch {
    return [];
  }
}

let tabs: Tab[] = load();
const listeners = new Set<() => void>();

function notify() {
  writeShellState('desktopTabs', JSON.stringify(tabs));
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // Private mode and the like: the tabs simply do not survive a restart.
  }
  listeners.forEach((l) => l());
}

export const tabKey = (kind: TabKind, ref: string) => `${kind}:${ref}`;

// Where the start page stood when it gave way to something opened from it:
// that thing takes its place in the row, not the row's end - the start page
// is FILLED, a browser's new tab.
let startSlot: number | null = null;

export function addTab(kind: TabKind, ref: string): Tab {
  const key = tabKey(kind, ref);
  const found = tabs.find((t) => t.key === key);
  const slot = startSlot;
  startSlot = null;
  if (found) return found;
  const tab = { key, kind, ref };
  tabs = slot !== null && slot <= tabs.length ? [...tabs.slice(0, slot), tab, ...tabs.slice(slot)] : [...tabs, tab];
  notify();
  return tab;
}

// «Відкрити в новій вкладці» on a note, a board, a day: a tab that knows
// its neighbours. Already open, it learns them.
export function openTabWithSequence(kind: TabKind, ref: string, seq: string[]): Tab {
  const key = tabKey(kind, ref);
  // A start page in the row is filled rather than a tab added beside it.
  const startAt = tabs.findIndex((t) => t.key === START_KEY);
  if (startAt !== -1) {
    const tab = { key, kind, ref, seq };
    tabs = tabs.flatMap((t, i) => (i === startAt ? [tab] : t.key === key ? [] : [t]));
    startFront = false;
    startIsHome = false;
    startSlot = null;
    notify();
    return tab;
  }
  const found = tabs.find((t) => t.key === key);
  const tab = { ...(found ?? { key, kind, ref }), seq };
  tabs = found ? tabs.map((t) => (t === found ? tab : t)) : [...tabs, tab];
  notify();
  return tab;
}

// One of its arrows: the SAME tab, in the same place in the row, now on
// `ref` - so stepping through a folder is one tab, not a tab per note. A
// tab already open on `ref` elsewhere gives way to it.
export function stepTab(key: string, ref: string): Tab | null {
  const at = tabs.findIndex((t) => t.key === key);
  if (at === -1) return null;
  const tab = { ...tabs[at], key: tabKey(tabs[at].kind, ref), ref };
  tabs = tabs.flatMap((t, i) => (i === at ? [tab] : t.key === tab.key ? [] : [t]));
  notify();
  return tab;
}

// Called by the editor itself, on whatever screen opened it - so every
// route into a note registers, and none of them has to remember to.
export function openTab(documentId: string): void {
  addTab('note', documentId);
}

// Answers what to show INSTEAD, so the caller does not have to work it
// out: the neighbour if there is one, or null for the documents list.
export function closeTab(key: string): Tab | null {
  const at = tabs.findIndex((t) => t.key === key);
  if (at === -1) return null;
  tabs = tabs.filter((t) => t.key !== key);
  notify();
  return tabs[at] ?? tabs[at - 1] ?? null;
}

export function useOpenTabs(): Tab[] {
  const [value, setValue] = useState(tabs);
  useEffect(() => {
    const listener = () => setValue(tabs);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}

// THE START PAGE: what the «+» opens - a tab of its own that stands in front
// of the navigator while it is the one chosen. Like a browser's new tab it
// gives way to whatever is opened from it (leaveStart), and stays in the
// row, keeping its place, if another tab is chosen instead.
export const START_KEY = 'start:new';
let startFront = false;
// THE HOME (2026-09-30, the user's): the ⌂ at the row's start is the start
// page now, not the documents list. The same page, standing in front with
// no tab of its own in the row - so opening something from it adds a tab
// and leaves the home where it is.
let startIsHome = false;

export function openHome(): void {
  startFront = true;
  startIsHome = true;
  startSlot = null;
  notify();
}

export function useStartIsHome(): boolean {
  const [value, setValue] = useState(startIsHome);
  useEffect(() => {
    const listener = () => setValue(startIsHome);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}

export function openStart(): void {
  if (!tabs.some((t) => t.key === START_KEY)) tabs = [...tabs, { key: START_KEY, kind: 'start', ref: 'new' }];
  startFront = true;
  startIsHome = false;
  notify();
}

export function showStart(front: boolean): void {
  if (startFront === front && (!front || !startIsHome)) return;
  startFront = front;
  if (front) startIsHome = false;
  notify();
}

// Something was opened from the start page: the page gives way to it.
export function leaveStart(): void {
  // The home gives way and stays home: nothing in the row to fill.
  if (startFront && startIsHome) {
    startFront = false;
    startIsHome = false;
    startSlot = null;
    notify();
    return;
  }
  const at = tabs.findIndex((t) => t.key === START_KEY);
  startSlot = at === -1 ? null : at;
  tabs = tabs.filter((t) => t.key !== START_KEY);
  startFront = false;
  notify();
}

// Leaving a note (its back arrow): its tab becomes the start page, in the
// same place in the row, ready to be filled with the next thing. There is
// only ever one start page, so one elsewhere gives way.
export function turnIntoStart(key: string): void {
  const rest = tabs.filter((t) => t.key !== START_KEY);
  const at = rest.findIndex((t) => t.key === key);
  const start: Tab = { key: START_KEY, kind: 'start', ref: 'new' };
  tabs = at === -1 ? [...rest, start] : rest.map((t, i) => (i === at ? start : t));
  startFront = true;
  startIsHome = false;
  startSlot = null;
  notify();
}

export function useStartFront(): boolean {
  const [value, setValue] = useState(startFront);
  useEffect(() => {
    const listener = () => setValue(startFront);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}

// WHAT WAS WORKED WITH LATELY, on this Mac only (the user's choice): every
// note, board and database the main pane has stood on, newest first. The
// start page's «Нещодавні».
export type RecentPlace = { kind: 'note' | 'board' | 'database'; ref: string; at: number };
const RECENT_KEY = 'mindeva.recentPlaces';
const RECENT_MAX = 30;

function loadRecent(): RecentPlace[] {
  try {
    const raw =
      readShellState('recentPlaces') ?? (typeof localStorage !== 'undefined' ? localStorage.getItem(RECENT_KEY) : null);
    const parsed = raw ? (JSON.parse(raw) as RecentPlace[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let recent: RecentPlace[] = loadRecent();
const recentListeners = new Set<() => void>();

export function noteRecent(kind: RecentPlace['kind'], ref: string): void {
  if (recent[0]?.kind === kind && recent[0]?.ref === ref) return;
  recent = [{ kind, ref, at: Date.now() }, ...recent.filter((r) => !(r.kind === kind && r.ref === ref))].slice(0, RECENT_MAX);
  writeShellState('recentPlaces', JSON.stringify(recent));
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Not kept past a restart, then.
  }
  recentListeners.forEach((l) => l());
}

export function useRecentPlaces(): RecentPlace[] {
  const [value, setValue] = useState(recent);
  useEffect(() => {
    const listener = () => setValue(recent);
    recentListeners.add(listener);
    listener();
    return () => {
      recentListeners.delete(listener);
    };
  }, []);
  return value;
}

// The row as it stands, and the whole of it replaced at once - what a saved
// workspace (workspaceTemplates) reads and puts back.
export function getTabs(): Tab[] {
  return tabs.filter((t) => t.kind !== 'start');
}

export function replaceTabs(next: Tab[]): void {
  tabs = next.filter((t) => t && typeof t.key === 'string' && t.kind !== 'start');
  startFront = false;
  startIsHome = false;
  notify();
}
