import { useLayoutEffect, useSyncExternalStore } from 'react';

// THE DESKS UNDER AN OPEN PAGE ARE NOT DRAWN (2026-10-28, «таблиці тестую» scrolled at 85-100% janky frames, the user:
// «пролагує при пролистування»). A note opened from a card or a list row is a transparent modal, so the desks stay
// drawn under it for the grow / slide and the fold back - and they stayed drawn for as long as the note was open, under
// an opaque page. Android draws (and prepares every bitmap of) everything in the window each frame, seen or not: the
// Start desk's pictures plus the note's own map snapshots outgrew the GPU's 118 MB cache, and every frame uploaded its
// textures again. Measured on the phone: desks left drawn 87-100% janky; made transparent, the same; taken out of the
// tree (display: none), 0.6%.
// So the frame around the page covers the desks once the page has finished growing, and hands them back - waiting for
// them to be laid out again - before it folds, which needs their card where it was.
let count = 0;
let hiddenNow = false;
const listeners = new Set<() => void>();
let waiters: (() => void)[] = [];

const notify = () => listeners.forEach((l) => l());

function settle() {
  if (hiddenNow) return;
  const ready = waiters;
  waiters = [];
  ready.forEach((w) => w());
}

// The page covers the screen. The answer hands the desks back; it resolves once they are laid out again (or at once,
// when they never went or another page still covers them).
export function coverBelow(): () => Promise<void> {
  count += 1;
  notify();
  let released = false;
  return () => {
    if (!released) {
      released = true;
      count -= 1;
      notify();
    }
    if (count > 0 || !hiddenNow) return Promise.resolve();
    return new Promise((resolve) => {
      waiters.push(resolve);
      // Whatever happens to the desks' render, the fold is not held up past this.
      setTimeout(() => {
        waiters = waiters.filter((w) => w !== resolve);
        resolve();
      }, 150);
    });
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

// For the desks themselves: whether to stand out of the tree, reported back once that is committed.
export function useBelowCovered(): boolean {
  const covered = useSyncExternalStore(subscribe, () => count > 0);
  useLayoutEffect(() => {
    hiddenNow = covered;
    settle();
  }, [covered]);
  return covered;
}
