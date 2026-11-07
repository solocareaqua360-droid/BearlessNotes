import { Platform } from 'react-native';

// The laptop's shape scale, in a file of its own with no imports of the
// theme: soft.ts needs it and desktopTheme.ts needs soft.ts.
// Round, the way Craft is (2026-10-01, "жодного різкого краю"): nothing on
// the laptop is told apart by a line, only by space, tone and a soft shadow.
export const RADIUS = {
  control: 8, // a field, a row that lights on hover
  menu: 14, // a menu at the click, a small popover
  card: 20, // a record, a tile, a document
  panel: 24, // a panel, the rail, a window
  pill: 999, // a button, a tab, a chip, a capsule
} as const;

// A card's corner: the scale's on the laptop (the web build), what the screen
// drew on a phone. The phone's rounder cards are its own and do not change.
export function cardRadius(native: number): number {
  return Platform.OS === 'web' ? RADIUS.card : native;
}

// A control's corner (a row that lights on hover, a field, a button): 8 on
// the laptop, the phone's own number on a phone.
export function controlRadius(native: number): number {
  return Platform.OS === 'web' ? RADIUS.control : native;
}

// A font size snapped to the laptop's five (12, 13.5, 15, 17, 22); on a phone
// the size the screen drew.
const TYPE_STEPS = [12, 13.5, 15, 17, 22];
export function deskSize(native: number): number {
  if (Platform.OS !== 'web') return native;
  return TYPE_STEPS.reduce((best, step) => (Math.abs(step - native) < Math.abs(best - native) ? step : best), TYPE_STEPS[0]);
}

// A whole style sheet put on the corner scale: every rounded corner of 5 or
// more becomes 8 (up to 10), 14 (up to 15), 20 (up to 21) or 24 - on the laptop only; on a
// phone the sheet comes back as it was. For a screen whose styles are too
// many to go through by hand (the editor's); a hairline's own tiny corner
// (under 5) is left alone.
export function snapRadii<T extends Record<string, unknown>>(sheet: T): T {
  if (Platform.OS !== 'web') return sheet;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(sheet)) {
    const style = sheet[key];
    if (style && typeof style === 'object' && typeof (style as { borderRadius?: unknown }).borderRadius === 'number') {
      const r = (style as { borderRadius: number }).borderRadius;
      const snapped = r < 5 || r >= 100 ? r : r <= 10 ? RADIUS.control : r <= 15 ? RADIUS.menu : r <= 21 ? RADIUS.card : RADIUS.panel;
      out[key] = { ...(style as object), borderRadius: snapped };
    } else {
      out[key] = style;
    }
  }
  return out as T;
}

// A PANEL THAT STANDS IN A CORNER OF THE WINDOW (the rail's card, the side
// panels, «Референси») is CONCENTRIC with the window's own corner: a corner
// nested in another at a gap runs parallel to it only when its radius is the
// outer one less the gap (the user, 2026-10-01: equal radii never line up).
// macOS 26 rounds a window like this ~16 pt, ~17 of the page's at the
// shell's 0.95 zoom; the panels stand 8 in.
export const WINDOW_CORNER = 17;
export const PANEL_INSET = 8;
export const WINDOW_INNER_RADIUS = WINDOW_CORNER - PANEL_INSET;
