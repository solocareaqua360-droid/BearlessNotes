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
export type TabKind = 'note' | 'board' | 'database' | 'section' | 'start' | 'target';
export type Tab = { key: string; kind: TabKind; ref: string };

const STORAGE_KEY = 'mindeva.desktopTabs';

function load(): Tab[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
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
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // Private mode and the like: the tabs simply do not survive a restart.
  }
  listeners.forEach((l) => l());
}

export const tabKey = (kind: TabKind, ref: string) => `${kind}:${ref}`;

export function addTab(kind: TabKind, ref: string): Tab {
  const key = tabKey(kind, ref);
  const found = tabs.find((t) => t.key === key);
  if (found) return found;
  const tab = { key, kind, ref };
  tabs = [...tabs, tab];
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

export function openStart(): void {
  if (!tabs.some((t) => t.key === START_KEY)) tabs = [...tabs, { key: START_KEY, kind: 'start', ref: 'new' }];
  startFront = true;
  notify();
}

export function showStart(front: boolean): void {
  if (startFront === front) return;
  startFront = front;
  notify();
}

// Something was opened from the start page: the page gives way to it.
export function leaveStart(): void {
  tabs = tabs.filter((t) => t.key !== START_KEY);
  startFront = false;
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
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RECENT_KEY) : null;
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
  notify();
}
