import { makeMutable, withDelay, withTiming } from 'react-native-reanimated';
import { morphBack, morphSheet } from './morph';

// THE AI CONVERSATION OPENS OUT OF ITS BALLOON (2026-10-23, the user's sketch «Морф кульки»): the balloon is one of the
// places in the desks' capsule; tapped, the orange capsule slides onto it (DeskDock), then a sheet grows out of it into the
// conversation's window (MorphHost through morphSheet), and the window folds back into it when closed - the capsule then
// slides home to the desk it came from. Not a desk of its own: the window exists only while it is open.
//
// HELD: from the tap until the window has folded back, the capsule belongs on the balloon. The dock is drawn anew while the
// window stands (the conversation has no dock), and a dock born then must stand on the balloon too - the one that forgot
// put the capsule on the desk at once and then jumped (the user: «підвисання» on the way to the balloon and back).
export const ASSIST_KEY = 'assistant';
// The fold back into the balloon takes this long (MorphHost: the cover, then the sheet's way back).
const FOLD_MS = 420;
let held = false;
const listeners = new Set<(held: boolean) => void>();

export function assistHeld(): boolean {
  return held;
}
export function onAssistHeld(fn: (held: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function setHeld(next: boolean) {
  held = next;
  listeners.forEach((l) => l(next));
}

// THE DOCK while the window stands: it is drawn above the growing sheet (its portal layer), so it stays while the circle
// grows out of the balloon, steps away once the window is open (else the screen-less dock of the conversation flashed
// over it), and comes back the moment the window starts folding - into the balloon, which has to be there.
export const assistDockCover = makeMutable(0);
// THE BALLOON HAS FLOWN OUT (the user, 2026-10-23: «кулька вилітає за межі доку... на місці доку буде пусто»): its place in
// the capsule stands empty - the balloon and its orange circle - from the moment the circle lifts off until the window has
// folded back into that place.
export const assistFlown = makeMutable(0);

export function openAssistant(navigate: () => void, color?: string, toColor?: string) {
  held = true;
  assistFlown.value = 1;
  // The rest of the dock steps away while the circle is half grown - at the hand-over it was still fading and the screen-
  // less dock of the conversation showed through it for a frame.
  assistDockCover.value = withDelay(140, withTiming(1, { duration: 160 }));
  morphSheet(
    ASSIST_KEY,
    () => {
      navigate();
    },
    { color, toColor }
  );
}

// The conversation's screen has gone, however it went (its cross, the system's back): once the window has folded into the
// balloon, the capsule goes home.
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
export function assistReturned() {
  // Gone by the system's back, with no fold: the dock comes back all the same.
  if (assistDockCover.value !== 0) assistDockCover.value = withTiming(0, { duration: 120 });
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    // The window has landed in the balloon's place: it is back, and then the capsule slides home.
    assistFlown.value = 0;
    setHeld(false);
  }, FOLD_MS);
}

// Its cross: the window folds into the balloon.
export function closeAssistant(leave: () => void, color?: string, toColor?: string) {
  assistDockCover.value = withTiming(0, { duration: 120 });
  morphBack(ASSIST_KEY, leave, { color, toColor });
}
