import { useSyncExternalStore } from 'react';

// THE NAME FIELD OF A NOTE JUST MADE FROM BLOCKS (2026-10-23, «У вкладену нотатку», as in Craft): the chosen blocks fold into
// a card, and the card opens a field with the caret in it - the one thing left to do is to name the note. One card at a
// time; the editor starts it, the card (BlockRow) draws the field and ends it.
type Naming = { blockId: string; onDone: (title: string) => void } | null;
let current: Naming = null;
const listeners = new Set<() => void>();

export function startNaming(blockId: string, onDone: (title: string) => void) {
  current = { blockId, onDone };
  listeners.forEach((l) => l());
}

export function finishNaming(blockId: string, title: string) {
  if (current?.blockId !== blockId) return;
  const done = current.onDone;
  current = null;
  listeners.forEach((l) => l());
  done(title.trim());
}

export function useNamingBlock(blockId: string): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => !!blockId && current?.blockId === blockId
  );
}
