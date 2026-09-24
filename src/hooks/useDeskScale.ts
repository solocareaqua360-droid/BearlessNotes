import { createContext, useContext } from 'react';
import { PixelRatio, useWindowDimensions } from 'react-native';

// SAMSUNG DEX HANDS US THE MONITOR AT DENSITY ONE, and that is the whole
// of what was wrong there.
//
// Measured on the device, 2026-09-24: window 1920x1080, density 1, while
// the same phone on its own screen is 475x751 at density 2.625. So DeX
// is not scaling anything and nothing is blurred by the system - every
// point this app draws simply becomes ONE pixel instead of two and a
// half. A dock capped at 430 points is 430 pixels across a 1920-pixel
// monitor; thirteen-point type is thirteen pixels tall. The user's own
// words for the result were a mush of pixels, and they were right.
//
// The answer is to pick our own density: lay the app out against a
// smaller logical screen and scale the whole tree up to fill the real
// one.
//
// Only where the numbers say so. On a phone, a tablet, a Fold or a
// browser the scale is one and the app is mounted exactly as it always
// was - see App.tsx, which renders no wrapper at all in that case.
// Two was the phone's own density and it overshot: a monitor is looked
// at from an arm's length rather than a hand's, and what a desk wants is
// MORE on it, not bigger. The user's own read - "його треба було
// зменшити, а не збільшити".
const TARGET_DENSITY = 1.5;
// Below this a screen is a device held in the hand, whatever it reports.
const DESK_MIN_WIDTH = 900;

export function useDeskScale(): number {
  const { width, height } = useWindowDimensions();
  const density = PixelRatio.get();
  if (density >= 1.5) return 1;
  if (Math.max(width, height) < DESK_MIN_WIDTH) return 1;
  // Halves, not any number: a scale of 1.5 leaves an odd size straddling
  // a pixel, which is mild, while an arbitrary fraction puts EVERY edge
  // between two - and that is the blur people blame on the platform.
  return Math.max(1, Math.min(3, Math.round((TARGET_DENSITY / density) * 2) / 2));
}

// The size the app is laid out against once that scale is applied - the
// window divided by it. Published because anything that reads the
// WINDOW's own size directly would otherwise be reading the monitor
// while everything around it is measured in the smaller space: the
// portal host is exactly that, and its dock ended up half a screen below
// the bottom edge.
export const DeskScaleContext = createContext<{ width: number; height: number } | null>(null);

export function useLogicalWindow(): { width: number; height: number } {
  const window = useWindowDimensions();
  return useContext(DeskScaleContext) ?? window;
}
