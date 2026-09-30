import type { View } from 'react-native';
import { dropDock } from './dockVeil';

// THE CARD THAT BECOMES THE PAGE, on the phone (the laptop's is the .web
// sibling, on view transitions).
//
// A PUSHED NOTE (the phone's own screen) - components/MorphFrame: the REAL
// page grows out of the card. The note is opened at once, over the list (a
// transparent modal, so the list stays drawn under it), and the whole page
// stands scaled down in the card's own rectangle; once the editor has drawn
// the note it grows to the full screen, and back it shrinks into the card
// before the screen goes. One picture from the first frame to the last.
//
// Two attempts before this said what not to do. 2026-09-24 flew a second
// render of the page and swapped it for the editor's - two renders are
// never the same pixels, it blinked at the swap. 2026-10-01's first phone
// version grew a blank sheet and faded it off the editor once that had
// loaded: no blink, but "розбілення екрану" for a second and no morph at
// all - the user's verdict. The page itself has to be what moves.
//
// A NOTE IN A PANE (the Fold's inner screen) still takes the blank sheet
// (components/MorphHost) - next to be converted.

export type Rect = { x: number; y: number; width: number; height: number };

// `into` / `from`: the key of a registered node the page stands in, when
// that is not the phone's full-screen sheet - the right half of the Fold's
// inner screen, where a note opens in a pane beside the list. That node
// only exists once the note is open, so it is measured after `update`.
type Driver = {
  open: (from: Rect, radius: number, color: string | undefined, key: string, update: () => void, into?: string) => void;
  back: (key: string, color: string | undefined, leave: () => void, from?: string) => void;
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
// When each page last said so: a page inside MorphFrame says it before the
// frame around it has had its own effects run (a child's effects run
// first), so a waiter that comes a moment late must still hear it.
const landedAt = new Map<string, number>();

export function whenLanded(key: string, then: () => void): void {
  const at = landedAt.get(key);
  if (at !== undefined && Date.now() - at < 1500) {
    landedAt.delete(key);
    then();
    return;
  }
  landedWaiters.set(key, then);
}

// Called by the editor once it has read its note and drawn it.
export function morphLanded(key: string): void {
  const then = landedWaiters.get(key);
  if (!then) {
    landedAt.set(key, Date.now());
    return;
  }
  landedWaiters.delete(key);
  then();
}

// ---- the card a pushed page grows out of --------------------------------------

// Handed from the tap to the page's MorphFrame, once.
const fromRects = new Map<string, Rect>();

export function takeMorphFrom(key: string): Rect | null {
  const rect = fromRects.get(key) ?? null;
  fromRects.delete(key);
  return rect;
}

// ---- the calls ---------------------------------------------------------------

// `update(true)` means the move is on and the screen should open without its
// own slide (a stack slide under a growing sheet is two moves fighting);
// `update(false)`, that it simply opens the way it always did.
export function morph(
  key: string,
  update: (morphing: boolean) => void,
  opts?: { color?: string; radius?: number; into?: string }
): void {
  const run = driver;
  if (!run && opts?.into) {
    update(false);
    return;
  }
  measureCard(key).then((from) => {
    if (!from) {
      update(false);
      return;
    }
    // A pushed page: the page itself grows out of the card (MorphFrame) -
    // it is handed the card's rectangle and opened at once.
    if (!opts?.into) {
      fromRects.set(key, from);
      landedAt.delete(key);
      // The list's dock goes with the tap; the note's comes in as the page
      // grows (MorphFrame).
      dropDock();
      update(true);
      return;
    }
    run!.open(from, opts?.radius ?? 22, opts?.color, key, () => update(true), opts?.into);
  });
}

// The page is left: the sheet comes up over it, `leave` takes the screen
// away under the sheet, and the sheet folds onto the card (or fades, with
// no card on screen to fold onto).
export function morphBack(key: string, leave: () => void, opts?: { color?: string; from?: string }): void {
  if (!driver) {
    leave();
    return;
  }
  driver.back(key, opts?.color, leave, opts?.from);
}

// Several dataSet markers on one element - the web's concern; nothing here.
export function morphKey(_key: string, _part?: 'child'): object {
  return {};
}

export function dataSets(...parts: object[]): object {
  const dataSet = Object.assign({}, ...parts.map((p) => (p as { dataSet?: object }).dataSet ?? {}));
  return Object.keys(dataSet).length ? { dataSet } : {};
}
