// The right-hand rail. Everything that floats over a screen stands in one
// column at the right edge now: the control capsule at the top, the tag
// and add buttons under it, and the navigation island at the bottom.
//
// One width runs through all of it - the island's own thickness. The
// capsule is that wide, the round buttons are that across, and the group
// pills are that tall.

// Android keeps the outermost ~20px at each edge for its own back
// gesture, so the rail stands a little in from the edge.
export const RAIL_RIGHT = 14;
export const RAIL_GAP = 12;

// The navigation island, laid out vertically.
export const NAV_BUTTON = 48;
export const NAV_PADDING = 8;
export const NAV_GAP = 6;
export const NAV_BOTTOM = 24;
export const NAV_ROUTES = 4;
export const RAIL_WIDTH = NAV_BUTTON + NAV_PADDING * 2;
export const NAV_HEIGHT = NAV_BUTTON * NAV_ROUTES + NAV_GAP * (NAV_ROUTES - 1) + NAV_PADDING * 2;

// The two round buttons between the island and the capsule.
export const RAIL_ADD_BOTTOM = NAV_BOTTOM + NAV_HEIGHT + RAIL_GAP;
export const RAIL_TAG_BOTTOM = RAIL_ADD_BOTTOM + RAIL_WIDTH + RAIL_GAP;

// A halo is drawn on a square twice the button's size, centred on it -
// the button's own box would clip it.
export const HALO = RAIL_WIDTH * 2;
export const HALO_INSET = (HALO - RAIL_WIDTH) / 2;
