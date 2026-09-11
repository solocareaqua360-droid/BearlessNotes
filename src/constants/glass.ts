// The one place the glass palette lives. Bottom sheets used to be white
// cards, each carrying its own greys as literals - so a change of mind
// meant fourteen files, and one of them always got missed. These are the
// values the fields sheet was converted to first; everything else follows
// them.
//
// Nearly opaque on purpose: what this wants is a real blur (expo-blur),
// and that is a native module, so it can only arrive with the next native
// build. Until then the hairline edge and the glass capsules carry the
// look and only a hint of the screen shows through.
export const GLASS_BODY = 'rgba(24,21,19,0.96)';
// For a sheet that has a real blur behind it (see GlassLayer): the fill
// only has to darken what the blur already softened, and at 0.96 it would
// hide it completely.
export const GLASS_BODY_BLURRED = 'rgba(24,21,19,0.55)';
// A small piece of glass that floats over the screen rather than covering
// it - the control island and the menu that opens beside it. Lighter than
// a sheet's fill: at sheet strength a capsule this size reads as a black
// pebble, and the blur under it stops showing at all.
export const GLASS_ISLAND = 'rgba(24,21,19,0.42)';
export const GLASS_EDGE = 'rgba(255,255,255,0.22)';
// A card or a row inside the sheet - a lift off the body, not a border.
export const GLASS_CARD = 'rgba(255,255,255,0.07)';
export const GLASS_LINE = 'rgba(255,255,255,0.14)';
export const GLASS_INPUT = 'rgba(255,255,255,0.10)';
export const GLASS_TEXT = '#fff';
export const GLASS_TEXT_MUTED = 'rgba(255,255,255,0.62)';
export const GLASS_TEXT_FAINT = 'rgba(255,255,255,0.3)';
// Blue and red go muddy on this body; both are lightened until they read
// as themselves again.
export const GLASS_ACCENT = '#8AB4FF';
export const GLASS_DANGER = '#FB7185';
// The dim behind a sheet. Lighter than it was for white sheets: the sheet
// itself is dark now, and two dark layers buried the screen under them.
export const GLASS_BACKDROP = 'rgba(17,24,39,0.45)';
