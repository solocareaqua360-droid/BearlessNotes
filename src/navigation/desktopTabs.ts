import { useEffect, useState } from 'react';

// Which notes are open, as tabs along the top.
//
// They are what makes a note taking the WHOLE window bearable. Without
// them, opening one is falling into it: the only way back is «Назад»,
// and the note you were comparing it against is gone. With them you are
// not leaving the list, you are switching between things you have open
// - which is what every editor on a desktop does, and what Craft does
// in the screenshot this came from.
//
// Ids only. The title is looked up live from the document index, so a
// note renamed anywhere is renamed on its tab.

let tabs: string[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

// Called by the editor itself, on whatever screen opened it - so every
// route into a note registers, and none of them has to remember to.
export function openTab(documentId: string): void {
  if (tabs.includes(documentId)) return;
  tabs = [...tabs, documentId];
  notify();
}

// Answers what to show INSTEAD, so the caller does not have to work it
// out: the neighbour if there is one, or null for the list.
export function closeTab(documentId: string): string | null {
  const at = tabs.indexOf(documentId);
  if (at === -1) return null;
  tabs = tabs.filter((id) => id !== documentId);
  notify();
  return tabs[at] ?? tabs[at - 1] ?? null;
}

export function useOpenTabs(): string[] {
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
