import { useEffect, useSyncExternalStore } from 'react';

// THE LIVE BLUR, PAUSED while something heavy scrolls under it.
//
// Every frosted piece of the bar and the dock (DockFrost) is a real-time
// blur: on each frame it draws the whole screen beneath it again and
// blurs that. Over a light list it costs nothing anyone notices; over
// the calendar's overview - a column of whole day pages, laid out full
// size and scaled down - five or six such pieces redrawing all of it on
// every frame is what made the scroll trail the finger ("затримка ... в
// темпі пролистування"). While a screen holds this, the pieces keep
// their colour and lose only the blur behind it - the same flat recipe
// a moving surface already uses.
let holders = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(delta: number) {
  holders += delta;
  listeners.forEach((l) => l());
}

export function useFrostPaused(): boolean {
  return useSyncExternalStore(subscribe, () => holders > 0, () => false);
}

export function usePauseFrost(active: boolean) {
  useEffect(() => {
    if (!active) return;
    set(1);
    return () => set(-1);
  }, [active]);
}
