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

// The tag row that scrolls along the foot of the screen, opposite the
// group tabs at the head of it.
export const TAG_ROW_HEIGHT = 45;
export const TAG_ROW_PAD = 4;

// What the rail has to fit between: the group tabs above and the tag row
// below. The capsule hangs under the tabs and the navigation island
// stands over the tags; the two round buttons space themselves out in
// what is left. Constants rather than measurements - four components
// share this column, and they cannot all measure each other, so these
// have to be kept in step with the real styles by hand (DocumentsScreen's
// sideIsland/groupsRow, TagsDrawer's tag row) whenever those change.
//
// How far in from the very top edge the group tabs start - shared with
// DocumentsScreen's own chromeTop, so the two never drift apart.
export const CHROME_TOP = 4;
// A pill (45) plus the row's own bottom padding (6).
const GROUPS_ROW_HEIGHT = 51;
// 3 buttons at 24 + 18 of padding at each end + 2 dividers at 1 + 4 gaps
// at 18 + the 1px border top and bottom. This was still the old 4-button,
// 21px-icon capsule's height (148) after the capsule grew - the mismatch
// was exactly why the round buttons didn't have room to sit clear of it.
const CAPSULE_HEIGHT = 184;

export function useRailLayout(windowHeight: number, insetTop: number, insetBottom: number) {
  const tagRowBottom = insetBottom + TAG_ROW_PAD;
  const foot = tagRowBottom + TAG_ROW_HEIGHT + RAIL_GAP;
  const head = insetTop + CHROME_TOP + GROUPS_ROW_HEIGHT + 8 + CAPSULE_HEIGHT;
  const free = windowHeight - head - foot;
  const gap = Math.max(RAIL_GAP, (free - (RAIL_WIDTH * 2 + NAV_HEIGHT)) / 4);
  const navBottom = foot + gap;
  const addBottom = navBottom + NAV_HEIGHT + gap;
  const tagBottom = addBottom + RAIL_WIDTH + gap;
  return { tagRowBottom, navBottom, addBottom, tagBottom };
}
