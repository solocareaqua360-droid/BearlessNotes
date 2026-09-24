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
// one. Two on a density-1 display puts a point back at two pixels, which
// is what every other screen this app runs on gives it.
//
// Only where the numbers say so. On a phone, a tablet, a Fold or a
// browser the scale is one and the app is mounted exactly as it always
// was - see App.tsx, which renders no wrapper at all in that case.
const TARGET_DENSITY = 2;
// Below this a screen is a device held in the hand, whatever it reports.
const DESK_MIN_WIDTH = 900;

export function useDeskScale(): number {
  const { width, height } = useWindowDimensions();
  const density = PixelRatio.get();
  if (density >= 1.5) return 1;
  if (Math.max(width, height) < DESK_MIN_WIDTH) return 1;
  // Whole numbers only: a fractional scale puts every edge in the app
  // between two pixels, which is the blur people blame on the platform.
  return Math.max(1, Math.min(3, Math.round(TARGET_DENSITY / density)));
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
