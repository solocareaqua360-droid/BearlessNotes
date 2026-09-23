import { useWindowDimensions } from 'react-native';
import { useDensity } from '../hooks/useDensity';
import { useNavDockOwnContext } from './navDock';

// The dock's own vertical geometry, read off ContextDock.tsx - which
// imports these same numbers rather than keeping a second copy (see its
// own import). Every screen that has to stand clear of the dock (a menu
// opening above it, a list's own bottom padding) computes it from here
// instead of guessing a number - guessing is exactly what put the dock a
// few points into a menu, or a menu a few points into the dock, on some
// screen widths: "в доці знову хаос". A number typed twice is a number
// that drifts once one of the two copies is edited and the other is not.
export const DOCK_BOTTOM = 22; // the dock's own distance from insets.bottom
const CARD_F = 0.148;
const BEHIND_EDGE = 3;
const WRAP_PADDING = 6; // vertical, top and bottom, see ContextDock's `wrap`
// A fraction of the screen is the right answer to "how big on a phone" and
// the wrong answer to "how big on a screen twice as wide" - see
// ContextDock's own PHONE_W. The dock's height is capped the same way, so
// a menu standing above it on a Fold or in the browser clears the dock's
// REAL height, not a phone-sized guess.
const PHONE_W = 430;
// How far the dock's row stands in from each edge, as a fraction of the
// screen - ContextDock's own INSET_F, moved here for the same reason
// every other number in this file is here: a panel that wants to be as
// wide as the dock has to read the dock's width, not a copy of it.
const INSET_F = 0.076;

export function dockCardHeight(windowWidth: number): number {
  return Math.round(Math.min(windowWidth, PHONE_W) * CARD_F);
}

// The dock's own body, edge to edge - not including DOCK_BOTTOM or the
// safe-area inset below it.
export function dockBodyHeight(windowWidth: number): number {
  return dockCardHeight(windowWidth) + BEHIND_EDGE * 2 + WRAP_PADDING * 2;
}

// What a screen adds ON TOP OF insets.bottom to stand clear of the dock -
// a menu's `bottom`, or a list's own `paddingBottom`. `gap` is the
// breathing room left above the dock itself.
export function dockClearance(windowWidth: number, gap: number = 12): number {
  return DOCK_BOTTOM + dockBodyHeight(windowWidth) + gap;
}

// The path that rises above the dock inside a folder (ContextDock's
// `pathUp`): its height and the gap between it and the dock's front card.
export const DOCK_PATH_H = 40;
export const DOCK_PATH_GAP = 6;

export function useDockClearance(gap?: number): number {
  const { width } = useWindowDimensions();
  // Inside a folder the path stands on top of the dock, and whatever has
  // to clear the dock has to clear it too. Only where the dock is drawn
  // at all - with a pointer the path lives in the toolbar.
  const own = useNavDockOwnContext();
  const density = useDensity();
  const pathUp = own?.kind === 'path' && density === 'touch';
  return dockClearance(width, gap) + (pathUp ? DOCK_PATH_H + DOCK_PATH_GAP : 0);
}

// The dock's row, edge to edge - what a panel matching its width should
// be, and where its left edge falls. The user's own ask, and the reason
// it belongs here rather than being measured by eye: a panel dropping
// out of the dock reads as the same object only while the two agree to
// the pixel, and they cannot agree if each works its own width out.
export function dockEdgeInset(windowWidth: number): number {
  return Math.round(Math.min(windowWidth, PHONE_W) * INSET_F);
}

export function dockRowWidth(windowWidth: number): number {
  return Math.min(windowWidth, PHONE_W) - dockEdgeInset(windowWidth) * 2;
}

export function useDockRowWidth(): number {
  const { width } = useWindowDimensions();
  return dockRowWidth(width);
}
