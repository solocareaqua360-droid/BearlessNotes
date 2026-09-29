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
export type TabKind = 'note' | 'board' | 'database' | 'section';
export type Tab = { key: string; kind: TabKind; ref: string };

const STORAGE_KEY = 'mindeva.desktopTabs';

function load(): Tab[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as Tab[]) : [];
    return Array.isArray(parsed) ? parsed.filter((t) => t && typeof t.key === 'string') : [];
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
