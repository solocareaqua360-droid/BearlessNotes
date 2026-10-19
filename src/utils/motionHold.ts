import { useEffect, useState } from 'react';

// A MOTION ON SCREEN THAT HEAVY BACKGROUND WORK MUST NOT LAND ON (2026-10-15: the «Думки» balloons froze twice on every
// opening of the app - each freeze was the explorer's PatternWarmup photographing one folder cover, ~800 shapes on the
// UI thread, 100-250 ms each, one every half second). Whoever starts such a motion holds this for its length; the
// background work waits while it is held.
let until = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  listeners.forEach((l) => l());
}

export function holdMotion(ms: number) {
  const end = Date.now() + ms;
  if (end <= until) return;
  until = end;
  notify();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    notify();
  }, ms + 20);
}

export function motionHeld() {
  return Date.now() < until;
}

export function useMotionHeld() {
  const [held, setHeld] = useState(motionHeld);
  useEffect(() => {
    const l = () => setHeld(motionHeld());
    listeners.add(l);
    l();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return held;
}

// THE LIST IS BEING SCROLLED (2026-10-16): a motion that runs for its own sake (the balloons breathing) stops at the
// first scroll - every frame it animates is a frame the scrolling has to share (it kept the Start desk redrawing 60
// times a second even at rest).
const movers = new Set<() => void>();
export function listMoved() {
  movers.forEach((m) => m());
  // A drag and the fling after it: no heavy background work lands on their frames.
  holdMotion(1800);
}
export function onListMoved(fn: () => void) {
  movers.add(fn);
  return () => {
    movers.delete(fn);
  };
}

// The pattern photographs (FolderPattern) one after another, never while a held motion plays: each is a burst of UI
// thread work.
let chain: Promise<unknown> = Promise.resolve();
export function queueHeavy<T>(job: () => Promise<T>): Promise<T> {
  const run = async () => {
    while (motionHeld()) await new Promise((r) => setTimeout(r, 300));
    await new Promise((r) => setTimeout(r, 120));
    return job();
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}

// AMBIENT motion (the balloons breathing for a while after they rise): the cover WARM-UP waits for it too - each warm
// job is 100-250 ms of UI thread, a visible hitch in a slow breath. The card pictures (queueHeavy) do not wait for it:
// they are cheap, and the sooner they replace the live patterns the lighter a scroll is.
let ambientUntil = 0;
const ambientListeners = new Set<() => void>();
let ambientTimer: ReturnType<typeof setTimeout> | null = null;
export function holdAmbient(ms: number) {
  const end = Date.now() + ms;
  if (end <= ambientUntil) return;
  ambientUntil = end;
  ambientListeners.forEach((l) => l());
  if (ambientTimer) clearTimeout(ambientTimer);
  ambientTimer = setTimeout(() => {
    ambientTimer = null;
    ambientListeners.forEach((l) => l());
  }, ms + 20);
}
export function releaseAmbient() {
  if (ambientUntil <= Date.now()) return;
  ambientUntil = 0;
  ambientListeners.forEach((l) => l());
}
export function useAmbientHeld() {
  const [held, setHeld] = useState(() => Date.now() < ambientUntil);
  useEffect(() => {
    const l = () => setHeld(Date.now() < ambientUntil);
    ambientListeners.add(l);
    l();
    return () => {
      ambientListeners.delete(l);
    };
  }, []);
  return held;
}
