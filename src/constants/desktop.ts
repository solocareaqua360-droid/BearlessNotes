// The laptop's sidebar, in points. Kept apart from DesktopRail so the few
// things that stand against its edge (the search corner) need not import
// the whole rail - and with it half the desktop shell - into the phone.
export const DESKTOP_RAIL_WIDTH = 240;

// The tab strip along the top of the main pane (28 of tab, 6 above and
// below, and its hairline) and the toolbar under it (46) - what anything
// drawn at window level, like the search corner, has to stand below.
export const DESKTOP_TABS_HEIGHT = 41;
export const DESKTOP_TOOLBAR_ROW = 46;
