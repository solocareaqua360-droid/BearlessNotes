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
