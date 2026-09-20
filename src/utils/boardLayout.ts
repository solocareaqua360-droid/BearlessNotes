// The board canvas's geometry. Lives here rather than inside BoardScreen
// because a group import (see importGroupToBoard) has to place columns and
// cards on that same canvas without the board being open - two copies of
// these numbers would silently drift the moment either is tuned.
export const DEFAULT_CARD_WIDTH = 160;
// A card can be made wider than the default - a picture on a board is
// sometimes the point of the board, and at 160 it is a thumbnail. The
// upper bound is a card that still leaves the canvas usable around it.
export const MIN_CARD_WIDTH = 120;
export const MAX_CARD_WIDTH = 900;
export const clampCardWidth = (width: number) =>
  Math.round(Math.max(MIN_CARD_WIDTH, Math.min(MAX_CARD_WIDTH, width)));
// The picture on a card is drawn in the shape the small card set - 144
// wide by 90 tall inside a 160 card - so a card made wider shows a
// BIGGER picture rather than the same thumbnail in more white.
export const CARD_IMAGE_PADDING = 8;
export const CARD_IMAGE_RATIO = 90 / (DEFAULT_CARD_WIDTH - CARD_IMAGE_PADDING * 2);
export const cardImageHeight = (cardWidth: number) =>
  Math.round((cardWidth - CARD_IMAGE_PADDING * 2) * CARD_IMAGE_RATIO);

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
// What a card is drawn at once it is IN a column. A card keeps its own
// width for the open canvas, but inside a column every card takes the
// column's inner width - otherwise a wider one (an import, a resized
// card) hangs out past its neighbours and the stack stops reading as a
// stack.
export const COLUMN_INNER_WIDTH = COLUMN_WIDTH - COLUMN_PADDING * 2;
export function widthInColumn(card: { width: number; columnId?: string }): number {
  return card.columnId ? COLUMN_INNER_WIDTH : card.width;
}
export const COLUMN_HEADER_HEIGHT = 44;
export const COLUMN_CARD_GAP = 12;
// A column with nothing in it still has to be a visible drop target.
export const COLUMN_MIN_HEIGHT = 220;
export const COLUMN_SPACING = 24;

// A free-standing frame (see BoardContainer) - unlike a column, it has
// no fixed width and no auto height: it is a rectangle the user draws
// out to whatever size they want, so both dimensions are stored and
// both need a floor that still reads as a usable region rather than a
// sliver.
export const CONTAINER_HEADER_HEIGHT = 32;
export const CONTAINER_MIN_WIDTH = 200;
export const CONTAINER_MIN_HEIGHT = 140;
export const CONTAINER_DEFAULT_WIDTH = 360;
export const CONTAINER_DEFAULT_HEIGHT = 260;
export const CONTAINER_SPACING = 24;
export const clampContainerWidth = (width: number) => Math.round(Math.max(CONTAINER_MIN_WIDTH, width));
export const clampContainerHeight = (height: number) => Math.round(Math.max(CONTAINER_MIN_HEIGHT, height));
