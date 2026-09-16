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
// The least the pieces of the rail may be pushed together before a shape
// counts as not fitting. Below the preferred gap on purpose: these few
// points are the difference between a capsule keeping its own place on a
// 736pt phone and having to join the one above it, twice now.
export const RAIL_MIN_GAP = 8;

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

// The side of a list that has to stay clear of the rail.
//
// Every list was written with the rail on the right and its clearance
// typed in as a paddingRight. In a pane the rail stands on the window's
// OUTER edge, which is the left one - and the clearance stayed where it
// was, so the cards ran under the buttons on one side and left a wide
// empty margin on the other. `base` is what that side keeps when the
// rail is not on it.
export function railClear(railSide: 'left' | 'right', base: number) {
  return railSide === 'left'
    ? { paddingLeft: RAIL_CLEARANCE, paddingRight: base }
    : { paddingLeft: base, paddingRight: RAIL_CLEARANCE };
}

// Where a toast at the foot of the screen may actually stand.
//
// A toast used to be `left: 16, right: 16, bottom: 24` - which put it
// squarely UNDER two things that float above every screen: the navigation
// island (bottom-centred, from insetBottom + NAV_BOTTOM up by one
// RAIL_WIDTH) and the rail's own lowest capsule, whose column runs down
// the right edge. Both are drawn through GlassPortal, i.e. ABOVE the
// screen that owns the toast, so they did not merely cover it - they took
// its taps. The action sits at the toast's right END, exactly in the
// rail's column, which is why "Скасувати" did nothing on any screen.
//
// So a toast clears the island in height and the rail in width. On a
// screen with no island (a pushed one - see railFreeHeight) it simply
// stands a little higher than it needs to, which is harmless and keeps
// every toast in the app on one line.
export function toastClear(railSide: 'left' | 'right', insetBottom: number) {
  return {
    bottom: insetBottom + NAV_BOTTOM + RAIL_WIDTH + 12,
    left: railSide === 'left' ? RAIL_CLEARANCE : 16,
    right: railSide === 'left' ? 16 : RAIL_CLEARANCE,
  };
}

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
// How tall a capsule is with `n` buttons in it.
//
// It used to be four hand-added constants, each one a sum written out in
// a comment, and one of them was left behind when the capsule grew - the
// round button below it ended up sitting on top of it. One function
// instead: 18 of padding at each end and a 24px icon, inside the 1px
// border; every button after the first brings its own icon, the hairline
// above it, and a gap on each side of that hairline.
export function capsuleHeightFor(buttons: number) {
  if (buttons <= 0) return 0;
  return 18 * 2 + 2 + buttons * 24 + (buttons - 1) * (18 * 2 + 1);
}

export const CAPSULE_HEIGHT = capsuleHeightFor(2);
export const CAPSULE_HEIGHT_3 = capsuleHeightFor(3);
export const CAPSULE_HEIGHT_4 = capsuleHeightFor(4);
export const CAPSULE_HEIGHT_1 = capsuleHeightFor(1);

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

// The height the stack of capsules actually has to share, between the top
// capsule and whatever stands at the foot.
//
// `hasIsland` is the piece that was missing. The navigation island belongs
// to the four TAB screens; a screen pushed on top of them (a database,
// files, photos) has none - and the rail was reserving its height there
// anyway. Eighty-eight points held for a bar that is not on the screen is
// what pushed a database's four capsules up over its own top capsule.
export function railFreeHeight(
  windowHeight: number,
  insetTop: number,
  insetBottom: number,
  capsuleHeight: number = CAPSULE_HEIGHT,
  hasIsland: boolean = true
) {
  const islandHeight = hasIsland ? NAV_BUTTON + NAV_PADDING * 2 : 0;
  const foot = insetBottom + NAV_BOTTOM + islandHeight;
  const head = insetTop + CHROME_TOP + CAPSULE_DROP + capsuleHeight;
  return { free: windowHeight - head - foot, foot, islandHeight };
}

// Whether a stack of this shape stands clear of the top capsule.
//
// The layout has no way to refuse: with the pieces too tall for the screen
// the gap simply clamps to its minimum and the top capsule is covered. So
// a screen that can choose what it puts on the rail asks this FIRST, and
// leaves out what does not fit - which is exactly the condition the user
// put on the fourth button.
export function railFits(
  free: number,
  actionsHeight: number,
  createHeight: number,
  historyHeight: number = 0,
  extraHeight: number = 0
) {
  const gaps = 3 + (historyHeight > 0 ? 1 : 0) + (extraHeight > 0 ? 1 : 0);
  return free - (actionsHeight + createHeight + historyHeight + extraHeight) >= gaps * RAIL_MIN_GAP;
}

// `actionsHeight`: the slot above the add button used to be the folder
// button (RAIL_WIDTH tall). The folder button is gone - the drawer opens
// on a swipe - and the slot holds the ACTIONS capsule now (sort, select),
// which is a capsule's height; a screen without one keeps the old size
// so nothing else moves. `createHeight`: the add button became a capsule
// that can carry a second button (a new folder, in the explorer);
// `historyHeight`: the explorer's back/forward capsule, absent (0)
// elsewhere. The pieces stack from the foot with one equal gap between
// them, so a screen with more of them simply spaces them a little tighter.
export function useRailLayout(
  windowHeight: number,
  insetTop: number,
  insetBottom: number,
  capsuleHeight: number = CAPSULE_HEIGHT,
  actionsHeight: number = RAIL_WIDTH,
  createHeight: number = RAIL_WIDTH,
  historyHeight: number = 0,
  hasIsland: boolean = true,
  // A FOURTH piece, above the actions capsule. The stack was three, which
  // is why a database with folders could not give back/forward a capsule
  // of its own the way the documents screen does - and the user was right
  // that this was never about height: it was the layout having nowhere to
  // put a fourth thing.
  extraHeight: number = 0
) {
  const tagRowBottom = insetBottom + TAG_ROW_PAD;
  const { free, foot, islandHeight } = railFreeHeight(windowHeight, insetTop, insetBottom, capsuleHeight, hasIsland);
  const navBottom = insetBottom + NAV_BOTTOM;
  const pieces = actionsHeight + createHeight + historyHeight + extraHeight;
  const gaps = 3 + (historyHeight > 0 ? 1 : 0) + (extraHeight > 0 ? 1 : 0);
  const gap = Math.max(RAIL_MIN_GAP, (free - pieces) / gaps);
  const addBottom = foot + gap;
  const historyBottom = addBottom + createHeight + gap;
  // The bottom edge of the actions capsule. Kept under its old name too.
  const actionsBottom = historyHeight > 0 ? historyBottom + historyHeight + gap : addBottom + createHeight + gap;
  const extraBottom = actionsBottom + actionsHeight + gap;
  const tagBottom = actionsBottom;
  return { tagRowBottom, navBottom, islandHeight, addBottom, historyBottom, tagBottom, actionsBottom, extraBottom };
}
