import type { Rect } from './morph';

// The one fold in progress (components/PageFold draws it). Kept apart from
// the component so utils/morph can end a fold without importing anything
// that draws.
export type Fold = {
  id: number;
  uri: string;
  // The note's frame in the window, and the card inside that frame.
  frame: Rect;
  card: Rect;
  sheetY: number;
  // The picture is on screen where the page is: the page may go.
  onShown: () => void;
};

let current: Fold | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
function announce() {
  listeners.forEach((l) => l());
}

export function subscribePageFold(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentPageFold(): Fold | null {
  return current;
}

export function startPageFold(fold: Omit<Fold, 'id'>): void {
  current = { ...fold, id: nextId++ };
  announce();
}

// A new page growing out of a card while an old one is still folding: the
// old picture goes at once rather than standing over the new page.
export function endPageFold(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  announce();
}
