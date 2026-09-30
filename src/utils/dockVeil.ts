import { makeMutable, withTiming } from 'react-native-reanimated';

// THE DOCK STEPPING ASIDE while a page grows out of its card or folds back
// into it (components/MorphFrame). The dock belongs to whichever screen is
// focused, and the screen changes at one instant of the move - so the old
// dock stood on over a page that was already leaving and the new one
// jumped in at the end (2026-10-01). Here the dock fades out as the move
// begins and comes back once it is over, already the other screen's.
//
// A stopgap, agreed as such: the real thing is the dock's own shape
// morphing from one screen's to the other's (the rail's morph, queued).
export const dockVeil = makeMutable(1);

// Whatever goes wrong on the way, the dock is never left hidden.
let guard: ReturnType<typeof setTimeout> | undefined;
function arm() {
  clearTimeout(guard);
  guard = setTimeout(() => unveilDock(), 2000);
}

export function veilDock(ms = 140): void {
  arm();
  dockVeil.value = withTiming(0, { duration: ms });
}

// At once - the tap that opens a note from its card.
export function dropDock(): void {
  arm();
  dockVeil.value = 0;
}

export function unveilDock(ms = 220): void {
  clearTimeout(guard);
  dockVeil.value = withTiming(1, { duration: ms });
}
