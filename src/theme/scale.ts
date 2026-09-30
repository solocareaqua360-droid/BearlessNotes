import { Platform } from 'react-native';

// The laptop's shape scale, in a file of its own with no imports of the
// theme: soft.ts needs it and desktopTheme.ts needs soft.ts.
export const RADIUS = {
  control: 8, // buttons, fields, rows that light on hover
  card: 14, // a record, a tile, a menu
  panel: 20, // a panel, a window
  pill: 999, // a chip, a capsule
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
// more becomes 8 (up to 10), 14 (up to 17) or 20 - on the laptop only; on a
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
      const snapped = r < 5 || r >= 100 ? r : r <= 10 ? RADIUS.control : r <= 17 ? RADIUS.card : RADIUS.panel;
      out[key] = { ...(style as object), borderRadius: snapped };
    } else {
      out[key] = style;
    }
  }
  return out as T;
}
