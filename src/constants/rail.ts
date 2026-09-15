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
export const CAPSULE_HEIGHT = 123;
// The same sum for a capsule carrying a third button: one more icon, one
// more divider - and TWO more gaps, since the divider it brings with it
// has a gap on each side. That last pair is what was missed first time
// round, and 18 short was still enough to leave the folder button sitting
// on top of the capsule. A screen with three buttons has to say so - both
// to useRail and to TagsDrawer, which is what places that button.
export const CAPSULE_HEIGHT_3 = CAPSULE_HEIGHT + 24 + 1 + 18 * 2;
// And a fourth: one more icon, one more divider, two more gaps again.
export const CAPSULE_HEIGHT_4 = CAPSULE_HEIGHT_3 + 24 + 1 + 18 * 2;
// A capsule carrying a single button: the padding at each end and the
// icon between them, inside the 1px border - the same sum as RAIL_WIDTH,
// named for what it is.
export const CAPSULE_HEIGHT_1 = 18 * 2 + 24 + 2;

// How far the capsule hangs below the top of the chrome band, and how far
// the island drops into the tag row's own band. Both rows keep the rail's
// width clear, so the two may overlap their bands without ever covering a
// pill - these are the two numbers that decide how much height the rail's
// four pieces have to share.
//
// The capsule hangs from this line and stays there. It was briefly tied
// to the list's own top instead, so that it stood exactly level with the
// first card - but then it jumped up with the cards whenever the group
// row was hidden. A constant is the whole point: 59 is that row plus the
// gap under it, which is where it sits with the row showing.
export const CAPSULE_DROP = 59;
const ISLAND_DROP = 10;

// `actionsHeight`: the slot above the add button used to be the folder
// button (RAIL_WIDTH tall). The folder button is gone - the drawer opens
// on a swipe - and the slot holds the ACTIONS capsule now (sort, select),
// which is a capsule's height; a screen without one keeps the old size
// so nothing else moves.
// `createHeight`: the add button became a capsule that can carry a second
// button (a new folder, in the explorer); `historyHeight`: the explorer's
// back/forward capsule, absent (0) everywhere else. The pieces stack from
// the foot with one equal gap between them, so a screen with more of
// them simply spaces them a little tighter.
export function useRailLayout(
  windowHeight: number,
  insetTop: number,
  insetBottom: number,
  capsuleHeight: number = CAPSULE_HEIGHT,
  actionsHeight: number = RAIL_WIDTH,
  createHeight: number = RAIL_WIDTH,
  historyHeight: number = 0
) {
  const tagRowBottom = insetBottom + TAG_ROW_PAD;
  // The navigation island is HORIZONTAL, at the foot of the screen in the
  // middle (see FloatingIslandTabBar) - not on the rail. The layout kept
  // reserving the island's old vertical height (four buttons stacked) at
  // the rail's foot, so with a fourth capsule the stack ran up over the
  // top one. The foot only has to clear the island's real, lying-down
  // height now.
  const islandHeight = NAV_BUTTON + NAV_PADDING * 2;
  const navBottom = insetBottom + NAV_BOTTOM;
  const foot = navBottom + islandHeight;
  const head = insetTop + CHROME_TOP + CAPSULE_DROP + capsuleHeight;
  const free = windowHeight - head - foot;
  const pieces = actionsHeight + createHeight + historyHeight;
  const gaps = historyHeight > 0 ? 4 : 3;
  const gap = Math.max(RAIL_GAP, (free - pieces) / gaps);
  const addBottom = foot + gap;
  const historyBottom = addBottom + createHeight + gap;
  // The bottom edge of the actions capsule. Kept under its old name too.
  const actionsBottom = historyHeight > 0 ? historyBottom + historyHeight + gap : addBottom + createHeight + gap;
  const tagBottom = actionsBottom;
  return { tagRowBottom, navBottom, islandHeight, addBottom, historyBottom, tagBottom, actionsBottom };
}
