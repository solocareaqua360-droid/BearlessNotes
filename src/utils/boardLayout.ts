// The board canvas's geometry. Lives here rather than inside BoardScreen
// because a group import (see importGroupToBoard) has to place columns and
// cards on that same canvas without the board being open - two copies of
// these numbers would silently drift the moment either is tuned.
export const DEFAULT_CARD_WIDTH = 160;
export const WORLD_SIZE = 6000;
export const WORLD_CENTER = WORLD_SIZE / 2;
// Cards don't carry their own rendered height (only width) - close enough
// for hit-testing the marquee-selection rectangle against, and for stacking
// an imported column before the real heights are measured on screen.
export const APPROX_CARD_HEIGHT = 140;
// A column is exactly wide enough for a default card plus its own padding
// on both sides, so a card dropped in sits flush.
export const COLUMN_PADDING = 12;
export const COLUMN_WIDTH = DEFAULT_CARD_WIDTH + COLUMN_PADDING * 2;
export const COLUMN_HEADER_HEIGHT = 44;
export const COLUMN_CARD_GAP = 12;
// A column with nothing in it still has to be a visible drop target.
export const COLUMN_MIN_HEIGHT = 220;
export const COLUMN_SPACING = 24;
