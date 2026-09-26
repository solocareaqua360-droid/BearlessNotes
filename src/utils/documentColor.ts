import type { Theme } from '../theme/tokens';

// Document card color assignment: each document gets a colour from the
// THEME's own card palette (`theme.cards`), derived from its own
// Firestore id, not a random pick per render
// (which would make cards flicker between colors on every list refresh)
// and not a stored field (which would need a Firestore write on every
// existing document to backfill). A deterministic hash of the id gives
// every document a color that looks "random" between documents, is stable
// across app restarts and re-renders, and works identically for documents
// created before this feature existed.

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Standard perceptual-luminance threshold for picking readable text over a
// solid fill - reuses the app's own near-black/white rather than pure
// #000/#fff so it still matches the rest of the UI's palette.
export function contrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 140 ? '#111827' : '#FFFFFF';
}

// The palette above is the COLOUR theme's alone. White and black mean
// white and black everywhere, databases included - the user was asked
// directly and was explicit about it - so a record there takes the
// theme's own surface and ink, and is told from the page by its lift and
// its edge rather than by a hue of its own.
//
// The theme is an argument rather than something read from a context,
// because this is called from inside list callbacks as often as from a
// component body. `useRecordColour` binds it once per component.
export function colorForDocument(
  id: string,
  theme?: Theme
): { background: string; text: string; textMuted: string } {
  if (theme && theme.key !== 'colour') {
    return { background: theme.surface, text: theme.ink.primary, textMuted: theme.ink.muted };
  }
  // The palette lives on the theme now, so a colour scheme can replace
  // it wholesale - the card fills are the app's biggest colour masses
  // and used to be the only ones with no rule behind them at all. The
  // fallback keeps this callable without a theme (a few call sites
  // still are) rather than crashing on an empty list.
  const palette = theme?.cards?.length ? theme.cards : ['#DAA587'];
  const background = palette[hashString(id) % palette.length];
  const text = contrastTextColor(background);
  const textMuted = text === '#FFFFFF' ? 'rgba(255,255,255,0.75)' : 'rgba(17,24,39,0.65)';
  return { background, text, textMuted };
}
