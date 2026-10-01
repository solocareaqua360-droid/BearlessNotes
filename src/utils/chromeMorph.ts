import { useEffect, useState } from 'react';
import type { View } from 'react-native';
import { makeMutable } from 'react-native-reanimated';
import { captureRef } from 'react-native-view-shot';
import type { Rect } from './morph';

// THE DOCK AND THE TOP BAR MOVING WITH THE PAGE (the phone's card-to-page
// morph, utils/morph + components/MorphFrame). Both belong to whichever
// screen is focused, and the focus changes at one instant of the move - so
// on their own they jumped from the list's to the note's at the push, and
// back at the pop (2026-10-01; fading them out and in instead looked
// "жахливо" and was reverted).
//
// What is done instead: the REAL chrome of both screens is photographed
// (react-native-view-shot) and a stand-in (components/ChromeMorph) draws the
// photographs over the app while the real chrome is hidden under it. The
// stand-in only animates SHAPE and opacity, on the same clock as the page:
//  - the top bar is the same capsule on both screens, so the list's picture
//    dissolves over the note's - what the two share (the capsule, "⋯") does
//    not move at all, only the middle and the brightness of "back" change;
//  - the dock changes shape: the list's search field and round "+" flow into
//    the note's single capsule of buttons, each shape showing its own
//    picture inside it.
// At both ends the real chrome stands exactly under its picture, so the
// hand-over is invisible. Anything missing (a capture that fails, a dock
// that is not there) and the chrome is simply left alone - the jump it had
// before, never a hole.

export type Part = 'bar' | 'dock';
// Which screen's: the list's ('list') or the note's ('note').
export type Side = 'list' | 'note';
export type Shot = { uri: string; rect: Rect };

// 0 = the list's chrome, 1 = the note's. Driven together with the page.
export const chromeT = makeMutable(0);
// 1 while the stand-in is drawn: the real dock and bar are hidden under it
// (ContextDock's DockPortal, TopNavBar's PortalLayer).
export const chromeCover = makeMutable(0);

// ---- the real chrome's nodes -------------------------------------------------

const nodes = new Map<string, View>();
const refs = new Map<string, (node: View | null) => void>();
const mounted = new Map<string, () => void>();

export function chromeNodeRef(part: Part, side: Side): (node: View | null) => void {
  const key = `${part}:${side}`;
  let fn = refs.get(key);
  if (!fn) {
    fn = (node) => {
      if (node) {
        nodes.set(key, node);
        const then = mounted.get(key);
        if (then) {
          mounted.delete(key);
          then();
        }
      } else if (nodes.get(key)) {
        nodes.delete(key);
      }
    };
    refs.set(key, fn);
  }
  return fn;
}

function measure(node: View): Promise<Rect | null> {
  return new Promise((resolve) => {
    try {
      node.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
    } catch {
      resolve(null);
    }
  });
}

async function grab(part: Part, side: Side): Promise<Shot | null> {
  const node = nodes.get(`${part}:${side}`);
  if (!node) return null;
  try {
    const rect = await measure(node);
    if (!rect) return null;
    const uri = await captureRef(node, { format: 'png', result: 'tmpfile' });
    return { uri, rect };
  } catch {
    return null;
  }
}

// ---- what the stand-in draws ---------------------------------------------------

export type Shots = { bar: Partial<Record<Side, Shot>>; dock: Partial<Record<Side, Shot>> };
type State = { active: boolean; shots: Shots };

let state: State = { active: false, shots: { bar: {}, dock: {} } };
// The list's pictures, kept from the way in for the way back: on the way
// back the list's chrome is not drawn until the very end.
let listKept: { bar?: Shot; dock?: Shot } = {};
const listeners = new Set<() => void>();
function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export function useChromeMorph(): State {
  const [value, setValue] = useState(state);
  useEffect(() => {
    const l = () => setValue(state);
    listeners.add(l);
    l();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return value;
}

// The stand-in reports each picture once it is decoded and drawn: the real
// chrome is hidden only under pictures that are really there.
const loaded = new Set<string>();
const loadWaiters = new Set<() => void>();
export function pictureLoaded(uri: string): void {
  loaded.add(uri);
  loadWaiters.forEach((w) => w());
}
function whenLoaded(uris: string[], ms = 250): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (uris.every((u) => loaded.has(u))) {
        loadWaiters.delete(check);
        clearTimeout(timer);
        resolve();
      }
    };
    const timer = setTimeout(() => {
      loadWaiters.delete(check);
      resolve();
    }, ms);
    loadWaiters.add(check);
    check();
  });
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// ---- the move ------------------------------------------------------------------

// Whether this move carries the chrome at all - decided at its start.
let carrying = false;
// Whatever hangs on the way, the real chrome is never left hidden: a whole
// move, its waits included, is well under this.
let watchdog: ReturnType<typeof setTimeout> | undefined;
function arm() {
  clearTimeout(watchdog);
  watchdog = setTimeout(() => chromeAbort(), 3000);
}

// The way in, at the tap, before the note is pushed: the list's chrome is
// photographed and stood in for, so the push can change the real chrome
// under it unseen. True when the stand-in is up.
export async function chromeOpenBegin(): Promise<boolean> {
  carrying = false;
  const [bar, dock] = await Promise.all([grab('bar', 'list'), grab('dock', 'list')]);
  if (!bar || !dock) return false;
  listKept = { bar, dock };
  chromeT.value = 0;
  set({ active: true, shots: { bar: { list: bar }, dock: { list: dock } } });
  await whenLoaded([bar.uri, dock.uri]);
  chromeCover.value = 1;
  carrying = true;
  arm();
  return true;
}

// The note has drawn itself: its chrome (hidden under the stand-in) is
// photographed, so the move has both ends.
export async function chromeOpenArrive(): Promise<void> {
  if (!carrying) return;
  const [bar, dock] = await Promise.all([grab('bar', 'note'), grab('dock', 'note')]);
  set({ active: true, shots: { bar: { ...state.shots.bar, note: bar ?? undefined }, dock: { ...state.shots.dock, note: dock ?? undefined } } });
  await whenLoaded([bar?.uri, dock?.uri].filter((u): u is string => !!u));
}

// The way back, before the page starts to fold: the note's chrome is
// photographed now, the list's comes from the way in.
export async function chromeBackBegin(): Promise<boolean> {
  carrying = false;
  if (!listKept.bar || !listKept.dock) return false;
  const [bar, dock] = await Promise.all([grab('bar', 'note'), grab('dock', 'note')]);
  if (!bar) return false;
  chromeT.value = 1;
  set({
    active: true,
    shots: { bar: { list: listKept.bar, note: bar }, dock: { list: listKept.dock, note: dock ?? undefined } },
  });
  await whenLoaded([listKept.bar.uri, listKept.dock.uri, bar.uri, dock?.uri].filter((u): u is string => !!u));
  chromeCover.value = 1;
  carrying = true;
  arm();
  return true;
}

// The move is over. On the way back the list's own chrome is waited for
// (it mounts with the list's focus) before the stand-in goes.
export async function chromeEnd(waitFor?: Side): Promise<void> {
  if (!carrying) return;
  carrying = false;
  clearTimeout(watchdog);
  if (waitFor) {
    // Both of them: the bar mounts with the screen's focus, the dock a
    // beat later, once the screen has published what it holds.
    const mount = (key: string) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 700);
        mounted.set(key, () => {
          clearTimeout(timer);
          resolve();
        });
      });
    await Promise.all([mount(`bar:${waitFor}`), mount(`dock:${waitFor}`)]);
    // And a beat for what they learn just after they mount (the bar its
    // folder): the stand-in is the same picture, so waiting costs nothing.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  await frame();
  await frame();
  chromeCover.value = 0;
  await frame();
  set({ active: false, shots: { bar: {}, dock: {} } });
}

// Something went wrong mid-way: the real chrome comes back at once.
export function chromeAbort(): void {
  clearTimeout(watchdog);
  carrying = false;
  chromeCover.value = 0;
  set({ active: false, shots: { bar: {}, dock: {} } });
}
