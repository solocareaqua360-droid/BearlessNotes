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

// How much of the screen's width the rail claims - what a row running
// along the head or the foot has to stay clear of, so its last pill isn't
// left sitting under the capsule or the island.
export const RAIL_CLEARANCE = RAIL_RIGHT + RAIL_WIDTH + RAIL_GAP;

// The band at the foot of the screen the island stops short of. It was
// the row of smart folders that used to scroll along there; that row is
// gone (they live in the drawer now), but the numbers stay as they are -
// they are what the rail's spacing was dialled in against on the device,
// and changing them would move every button again.
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
// 2 buttons at 24 + 18 of padding at each end + 1 divider + 2 gaps at 18
// + the 1px border top and bottom. Keep this in step with the capsule
// itself: when it was left saying 184 for a capsule that had grown, the
// round buttons ended up with no room to sit clear of it.
const CAPSULE_HEIGHT = 123;

// How far the capsule hangs below the top of the chrome band, and how far
// the island drops into the tag row's own band. Both rows keep the rail's
// width clear, so the two may overlap their bands without ever covering a
// pill - these are the two numbers that decide how much height the rail's
// four pieces have to share, and both were dialled in by eye on the
// device: the capsule 15 above where it used to hang, the island 10 below.
export const CAPSULE_DROP = 44;
const ISLAND_DROP = 10;

export function useRailLayout(windowHeight: number, insetTop: number, insetBottom: number) {
  const tagRowBottom = insetBottom + TAG_ROW_PAD;
  const foot = tagRowBottom + TAG_ROW_HEIGHT + RAIL_GAP - ISLAND_DROP;
  const head = insetTop + CHROME_TOP + CAPSULE_DROP + CAPSULE_HEIGHT;
  const free = windowHeight - head - foot;
  const gap = Math.max(RAIL_GAP, (free - (RAIL_WIDTH * 2 + NAV_HEIGHT)) / 4);
  const navBottom = foot + gap;
  const addBottom = navBottom + NAV_HEIGHT + gap;
  const tagBottom = addBottom + RAIL_WIDTH + gap;
  return { tagRowBottom, navBottom, addBottom, tagBottom };
}
