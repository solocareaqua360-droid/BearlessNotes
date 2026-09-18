// What is left of the right-hand rail, now that every screen's own
// capsule and vertical stack moved onto the dock (see ContextDock and
// navDock) - a handful of numbers two screens still measure against
// directly: the document editor's own corner capsule and the calendar's
// (neither has joined the dock yet - see the project memory), plus the
// side-clearance a few lists still keep for a pane's outer edge.

// Android keeps the outermost ~20px at each edge for its own back
// gesture, so a rail-era capsule stood a little in from the edge.
export const RAIL_RIGHT = 14;
export const RAIL_GAP = 12;

// The navigation island's own thickness, in the two places that still
// reason about it directly.
export const NAV_BUTTON = 48;
export const NAV_PADDING = 8;
export const NAV_GAP = 6;
export const NAV_BOTTOM = 24;
export const RAIL_WIDTH = NAV_BUTTON + NAV_PADDING * 2;

// How much of the screen's width a rail-era capsule claimed - what a row
// running along the head or the foot still has to stay clear of on the
// two screens that have not moved to the dock.
export const RAIL_CLEARANCE = RAIL_RIGHT + RAIL_WIDTH + RAIL_GAP;

// The side of a list that has to stay clear of that capsule.
//
// In a pane the rail stands on the window's OUTER edge, which is the
// left one - and the clearance stayed where it was, so the cards ran
// under the buttons on one side and left a wide empty margin on the
// other. `base` is what that side keeps when the rail is not on it.
export function railClear(railSide: 'left' | 'right', base: number) {
  return railSide === 'left'
    ? { paddingLeft: RAIL_CLEARANCE, paddingRight: base }
    : { paddingLeft: base, paddingRight: RAIL_CLEARANCE };
}

// Where a toast at the foot of the screen may actually stand.
//
// A toast used to be `left: 16, right: 16, bottom: 24` - which put it
// squarely UNDER two things that floated above every screen: the
// navigation island (bottom-centred) and a rail-era capsule's own lowest
// piece, whose column ran down the right edge. Both were drawn through
// GlassPortal, i.e. ABOVE the screen that owns the toast, so they did
// not merely cover it - they took its taps. The action sat at the
// toast's right END, exactly in the rail's column, which is why
// "Скасувати" did nothing on any screen.
export function toastClear(railSide: 'left' | 'right', insetBottom: number) {
  return {
    bottom: insetBottom + NAV_BOTTOM + RAIL_WIDTH + 12,
    left: railSide === 'left' ? RAIL_CLEARANCE : 16,
    right: railSide === 'left' ? 16 : RAIL_CLEARANCE,
  };
}

// How far in from the very top edge the group tabs and the two remaining
// rail-era capsules start - shared across every screen that measures
// against it, so none of them can drift apart from each other.
export const CHROME_TOP = 4;

// How far a screen's own top capsule used to hang below the top of the
// chrome band. Read by the two screens that have not joined the dock yet
// (the document editor's own corner capsule, and the calendar's).
export const CAPSULE_DROP = 59;
