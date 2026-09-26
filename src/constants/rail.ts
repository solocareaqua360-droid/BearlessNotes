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

// What a list keeps clear of at its sides. PLAIN, EQUAL PADDING NOW -
// there is no side rail any more, so there is nothing to stand out of
// the way of. It used to hand one side 90pt: the rail's own width plus
// its insets, reserved unconditionally, about a quarter of a phone
// screen. That was the rail's real cost and it outlived the rail by a
// day - "сітка квадратів в один ряд хоча могла бути в два ряди і папки
// не до кінця екрану розтягнуті".
//
// The signature keeps its first argument, ignored, so that the dozen
// call sites do not each have to be rewritten to say the same thing.
// Same shape as `shellClear` in PlainScreenShell, which lost its rail
// first.
export function railClear(_railSide: 'left' | 'right', base: number) {
  return { paddingHorizontal: base };
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
export function toastClear(_railSide: 'left' | 'right', insetBottom: number) {
  return {
    // The dock is still down there and is still drawn above this, so the
    // height stands. What went is the COLUMN the rail used to run down
    // one side: the action sat at the toast's far end, in that column,
    // and now there is nothing there to sit under.
    bottom: insetBottom + NAV_BOTTOM + RAIL_WIDTH + 12,
    left: 16,
    right: 16,
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
