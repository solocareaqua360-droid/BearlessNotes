import type { SharedValue } from 'react-native-reanimated';

// THE NOTE ROLLS BACK TO ITS TOP WHILE IT FOLDS INTO ITS CARD (2026-10-25, the user: «в довгих нотатках при прокручуванні…
// при виході прев'ю з блиманням встає замість прокрученого вигляду; треба прокручувати нотатку в процесі виходу, щоб на
// момент постановки на своє місце картинки співпадали»). The card shows the note's top; a note folded as it stood,
// scrolled, was swapped for that top on landing - a blink. The editor says how far it is scrolled and lends a shared
// value MorphFrame runs on the fold's own clock: 1 = where it stood, 0 = the top.
export type PageScroller = { offset: () => number; from: SharedValue<number>; roll: SharedValue<number> };

const scrollers = new Map<string, PageScroller>();

export function registerPageScroll(key: string, s: PageScroller): () => void {
  scrollers.set(key, s);
  return () => {
    if (scrollers.get(key) === s) scrollers.delete(key);
  };
}

export function pageScroller(key: string): PageScroller | undefined {
  return scrollers.get(key);
}
