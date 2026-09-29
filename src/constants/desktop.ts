// The laptop's sidebar, in points. Kept apart from DesktopRail so the few
// things that stand against its edge (the search corner) need not import
// the whole rail - and with it half the desktop shell - into the phone.
export const DESKTOP_RAIL_WIDTH = 240;

// The tab strip along the top of the main pane (28 of tab, 6 above and
// below, and its hairline) and the toolbar under it (46) - what anything
// drawn at window level, like the search corner, has to stand below.
export const DESKTOP_TABS_HEIGHT = 41;
export const DESKTOP_TOOLBAR_ROW = 46;

// A window is NARROW below this (CSS points): half a screen beside another
// application is the way this app is really used on a Mac, and at 720-760
// the full rail, the main pane and a side column cannot all stand at once.
// Narrow, the rail folds to icons and the side column is capped so the main
// pane keeps room to be used.
export const DESKTOP_NARROW_BELOW = 1000;
export const DESKTOP_RAIL_NARROW = 52;
export const DESKTOP_MAIN_MIN = 380;

import { useWindowDimensions } from 'react-native';

export function useDesktopNarrow(): boolean {
  return useWindowDimensions().width < DESKTOP_NARROW_BELOW;
}

// The rail's width now, as anything standing against its edge needs it.
export function useDesktopRailWidth(): number {
  return useDesktopNarrow() ? DESKTOP_RAIL_NARROW : DESKTOP_RAIL_WIDTH;
}

// The band along the very top of the window where macOS puts the traffic
// lights (the shell hides its own title bar): the rail keeps it empty, and
// it drags the window.
export const DESKTOP_TITLE_BAND = 40;
