// The tile board's packing, and the sizes a tile is allowed to be.
//
// Four columns, and every tile is a whole number of cells wide and tall.
// A wrapping row cannot do this: a row is as tall as its tallest tile, so
// a short tile beside a tall one leaves a hole underneath it that nothing
// can ever fill. So the tiles are placed instead of flowed - each one
// takes the first gap it fits in, scanning left to right, top to bottom,
// which is what makes a board of mixed sizes close up on itself.

export const TILE_COLUMNS = 4;

export type TileSize = { w: number; h: number };

// The sizes the user picked. Anything stored that is not one of these (an
// older value, a hand-edited document) falls back to the small square.
export const TILE_SIZES: TileSize[] = [
  { w: 1, h: 1 },
  { w: 1, h: 2 },
  { w: 2, h: 1 },
  { w: 2, h: 2 },
  { w: 3, h: 1 },
  { w: 4, h: 1 },
  { w: 4, h: 2 },
];

export const DEFAULT_TILE_SIZE: TileSize = { w: 2, h: 2 };

export function parseTileSize(stored: unknown): TileSize | null {
  if (typeof stored !== 'string') return null;
  const [w, h] = stored.split('x').map((n) => Number.parseInt(n, 10));
  return TILE_SIZES.find((s) => s.w === w && s.h === h) ?? null;
}

export function formatTileSize(size: TileSize): string {
  return `${size.w}x${size.h}`;
}

// The allowed size closest to a freely dragged one. Distance is measured
// in cells, with width counting double: dragging sideways is how a tile is
// made wide, and a drag that clearly went wide should not land on a tall
// tile just because the two are equally far away in raw numbers.
export function snapTileSize(w: number, h: number): TileSize {
  let best = TILE_SIZES[0];
  let bestDistance = Infinity;
  for (const size of TILE_SIZES) {
    const distance = Math.abs(size.w - w) * 2 + Math.abs(size.h - h);
    if (distance < bestDistance) {
      best = size;
      bestDistance = distance;
    }
  }
  return best;
}

export type PlacedTile<T> = { item: T; x: number; y: number; size: TileSize };

// Places tiles in order into a 4-wide grid of cells, returning each one's
// cell coordinates and how many rows the whole board came to.
//
// `breakBefore` starts a tile on a fresh row below everything placed so
// far - what the rule between the built-in databases and the user's own
// is drawn on.
export function packTiles<T>(
  items: T[],
  sizeOf: (item: T) => TileSize,
  breakBefore?: (item: T) => boolean
): { placed: PlacedTile<T>[]; rows: number } {
  // occupied[row] is a bitmask of the columns taken in that row.
  const occupied: number[] = [];
  const placed: PlacedTile<T>[] = [];
  let floor = 0;

  const isFree = (x: number, y: number, size: TileSize) => {
    for (let row = y; row < y + size.h; row += 1) {
      const taken = occupied[row] ?? 0;
      for (let col = x; col < x + size.w; col += 1) {
        if (taken & (1 << col)) return false;
      }
    }
    return true;
  };

  const take = (x: number, y: number, size: TileSize) => {
    for (let row = y; row < y + size.h; row += 1) {
      let taken = occupied[row] ?? 0;
      for (let col = x; col < x + size.w; col += 1) taken |= 1 << col;
      occupied[row] = taken;
    }
  };

  for (const item of items) {
    const size = sizeOf(item);
    if (breakBefore?.(item)) floor = occupied.length;
    let y = floor;
    let x = 0;
    // Scan for the first gap this tile fits in. The loop always ends: past
    // the last occupied row every position is free.
    for (;;) {
      if (x + size.w <= TILE_COLUMNS && isFree(x, y, size)) break;
      x += 1;
      if (x + size.w > TILE_COLUMNS) {
        x = 0;
        y += 1;
      }
    }
    take(x, y, size);
    placed.push({ item, x, y, size });
  }

  return { placed, rows: occupied.length };
}
