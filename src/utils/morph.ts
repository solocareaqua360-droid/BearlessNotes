import type { View } from 'react-native';

// THE CARD THAT BECOMES THE PAGE, on the phone (the laptop's is the .web
// sibling, on view transitions). Drawn by MorphHost (components/MorphHost),
// mounted once at the app's root above everything; this file is what the
// rest of the app calls.
//
// NOT the 2026-09-24 attempt (reverted - see the pending-morph memory). That
// one flew a second render of the page and swapped it for the editor's, and
// two renders of one page are never the same pixels: it blinked at the hand-
// over however it was tuned. Here nothing is drawn twice. What moves is a
// plain sheet of the page's colour: it comes up over the card (the card's
// picture fades into paper), grows to where the page will stand, the editor
// is opened under it, and once the editor has drawn itself (morphLanded) the
// sheet fades away off the real page. A dissolve from blank paper has no
// second picture to disagree with. The way back is the same, reversed.

export type Rect = { x: number; y: number; width: number; height: number };

type Driver = {
  open: (from: Rect, radius: number, color: string | undefined, key: string, update: () => void) => void;
  back: (key: string, color: string | undefined, leave: () => void) => void;
};

let driver: Driver | null = null;
export function setMorphDriver(next: Driver | null): void {
  driver = next;
}

// ---- the cards ---------------------------------------------------------------

const cards = new Map<string, View>();
const refs = new Map<string, (node: View | null) => void>();

// One callback per key, kept: a fresh function every render would have React
// detach and reattach every card's ref on every render of a long list.
export function morphCardRef(key: string): ((node: View | null) => void) | undefined {
  let fn = refs.get(key);
  if (!fn) {
    fn = (node) => {
      if (node) cards.set(key, node);
      else cards.delete(key);
    };
    refs.set(key, fn);
  }
  return fn;
}

export function measureCard(key: string): Promise<Rect | null> {
  const node = cards.get(key);
  if (!node) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      node.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
    } catch {
      resolve(null);
    }
  });
}

// ---- the page saying it is drawn ---------------------------------------------

const landedWaiters = new Map<string, () => void>();

export function whenLanded(key: string, then: () => void): void {
  landedWaiters.set(key, then);
}

// Called by the editor once it has read its note and drawn it.
export function morphLanded(key: string): void {
  const then = landedWaiters.get(key);
  if (!then) return;
  landedWaiters.delete(key);
  then();
}

// ---- the calls ---------------------------------------------------------------

// `update(true)` means the move is on and the screen should open without its
// own slide (a stack slide under a growing sheet is two moves fighting);
// `update(false)`, that it simply opens the way it always did.
export function morph(key: string, update: (morphing: boolean) => void, opts?: { color?: string; radius?: number }): void {
  const run = driver;
  if (!run) {
    update(false);
    return;
  }
  measureCard(key).then((from) => {
    if (!from) {
      update(false);
      return;
    }
    run.open(from, opts?.radius ?? 22, opts?.color, key, () => update(true));
  });
}

// The page is left: the sheet comes up over it, `leave` takes the screen
// away under the sheet, and the sheet folds onto the card (or fades, with
// no card on screen to fold onto).
export function morphBack(key: string, leave: () => void, opts?: { color?: string }): void {
  if (!driver) {
    leave();
    return;
  }
  driver.back(key, opts?.color, leave);
}

// Several dataSet markers on one element - the web's concern; nothing here.
export function morphKey(_key: string, _part?: 'child'): object {
  return {};
}

export function dataSets(...parts: object[]): object {
  const dataSet = Object.assign({}, ...parts.map((p) => (p as { dataSet?: object }).dataSet ?? {}));
  return Object.keys(dataSet).length ? { dataSet } : {};
}
