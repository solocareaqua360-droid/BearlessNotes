// The tile board's packing, and the sizes a tile is allowed to be.
//
// Four columns, and every tile is a whole number of cells wide and tall.
// A wrapping row cannot do this: a row is as tall as its tallest tile, so
// a short tile beside a tall one leaves a hole underneath it that nothing
// can ever fill. So the tiles are placed instead of flowed - each one
// takes the first gap it fits in, scanning left to right, top to bottom,
// which is what makes a board of mixed sizes close up on itself.

// The board is four columns on a phone. On a wider screen it is MORE
// columns rather than bigger cells: the user's own rule - the tiles must
// not simply scale up, they must regroup - and since a tile's size is
// stored in cells, keeping the cell the same size is what keeps the tile
// the same size while the packing below finds it a new place.
export const TILE_COLUMNS = 4;
// What a cell comes out as on a phone, and so what it should stay near.
const TARGET_CELL = 84;

export function tileColumnsFor(boardWidth: number, gap: number): number {
  if (boardWidth <= 0) return TILE_COLUMNS;
  const columns = Math.round((boardWidth + gap) / (TARGET_CELL + gap));
  // Never fewer than four - the stored sizes go up to four cells wide, and
  // a tile wider than the board has nowhere to be placed at all.
  return Math.max(TILE_COLUMNS, Math.min(12, columns));
}

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
export function snapTileSize(w: number, h: number, minWidth = 1): TileSize {
  let best = TILE_SIZES.find((size) => size.w >= minWidth) ?? TILE_SIZES[0];
  let bestDistance = Infinity;
  for (const size of TILE_SIZES) {
    // Some tiles cannot be made narrow: one cell holds an icon and
    // nothing else, which is fine for a database you recognise and
    // useless for a button that has to say what it does.
    if (size.w < minWidth) continue;
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
  breakBefore?: (item: T) => boolean,
  columns: number = TILE_COLUMNS
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
      if (x + size.w <= columns && isFree(x, y, size)) break;
      x += 1;
      if (x + size.w > columns) {
        x = 0;
        y += 1;
      }
    }
    take(x, y, size);
    placed.push({ item, x, y, size });
  }

  return { placed, rows: occupied.length };
}

// A set of sizes that fills the board solid - what the user asked for as
// "інтелектуальний хаотичний підбір без дірок".
//
// Not random, though it reads as varied: the board is walked row by row,
// and each tile is given the widest allowed size that still fits the gap
// in front of it. A gap of one cell therefore gets a one-cell tile rather
// than being left empty, which is the whole point - holes are what a
// hand-picked board fills up with.
//
// Heights vary with a repeating pattern rather than a coin toss, so the
// result is stable: pressing the button twice does not reshuffle a board
// the user has just accepted.
export function packedSizes(keys: string[], columns: number): Record<string, string> {
  const HEIGHTS = [2, 1, 2, 1, 1, 2];
  const out: Record<string, string> = {};
  // occupied[row] counts the cells taken in that row, filled left to right.
  let row = 0;
  let used = 0;
  keys.forEach((key, index) => {
    const left = columns - used;
    const height = HEIGHTS[index % HEIGHTS.length];
    // The widest size allowed that fits what is left of this row, and that
    // exists in TILE_SIZES at this height.
    let best: TileSize | null = null;
    for (const size of TILE_SIZES) {
      if (size.h !== height) continue;
      if (size.w > left) continue;
      if (!best || size.w > best.w) best = size;
    }
    // Nothing of that height fits the gap - take the widest of any height.
    if (!best) {
      for (const size of TILE_SIZES) {
        if (size.w > left) continue;
        if (!best || size.w > best.w) best = size;
      }
    }
    const size = best ?? { w: 1, h: 1 };
    out[key] = formatTileSize(size);
    used += size.w;
    if (used >= columns) {
      used = 0;
      row += 1;
    }
  });
  return out;
}

// A tile's own cell on the board, where the user put it.
export type TilePosition = { x: number; y: number };

export function parseTilePosition(stored: unknown): TilePosition | null {
  if (typeof stored !== 'string') return null;
  const [x, y] = stored.split(',').map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
  return { x, y };
}

export function formatTilePosition(position: TilePosition): string {
  return `${position.x},${position.y}`;
}

// Places tiles the way the user left them, and packs the rest around them.
//
// The board used to keep only an ORDER, and the packer decided where each
// tile stood - so a dragged tile could land anywhere a gap happened to be,
// which the user felt as no control at all. A tile that has been put
// somewhere keeps its cell now; only tiles that have not (a new database,
// a board never arranged) still flow into the first gap.
//
// A placed tile whose cell is taken (another tile dropped on it, a tile
// beside it grown over it) is not sent back to the top of the board to
// fill whatever hole is there - that is what the user saw as "the tiles
// I just put down move off to fill holes". It goes to the nearest free
// spot AFTER its own cell, so it stays where it was put, or as near as it
// can. A cell that no longer fits the column count (the board got
// narrower) is treated as the start of its row.
//
// `first` names a tile that wins every collision - the one under the
// finger, which must land where the finger is whatever else is there.
// `settleFrom` names tiles allowed to move EARLIER, and the cell they
// may start looking from: while a tile is being shrunk, the tiles after
// it look from the shrinking tile's own cell, so the space it frees is
// taken as it frees it. Each still ends up at or before its own cell
// unless that cell is taken too.
export function placeTiles<T>(
  items: T[],
  sizeOf: (item: T) => TileSize,
  positionOf: (item: T) => TilePosition | null,
  columns: number,
  breakBefore?: (item: T) => boolean,
  first?: (item: T) => boolean,
  settleFrom?: (item: T) => TilePosition | null
): { placed: PlacedTile<T>[]; rows: number } {
  const occupied: number[] = [];
  const isFree = (x: number, y: number, size: TileSize) => {
    for (let row = y; row < y + size.h; row += 1) {
      const taken = occupied[row] ?? 0;
      for (let col = x; col < x + size.w; col += 1) if (taken & (1 << col)) return false;
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
  // The first free spot for this size, reading on from `from`. Always
  // ends: past the last occupied row every position is free.
  const scan = (from: TilePosition, size: TileSize): TilePosition => {
    let x = Math.min(from.x, Math.max(0, columns - size.w));
    let y = from.y;
    for (;;) {
      if (x + size.w <= columns && isFree(x, y, size)) return { x, y };
      x += 1;
      if (x + size.w > columns) {
        x = 0;
        y += 1;
      }
    }
  };

  // First the tiles that have a place, in the order of those places, so
  // that when two of them are pushed the earlier one settles first.
  const positioned = items
    .map((item) => ({ item, position: positionOf(item) }))
    .filter((entry): entry is { item: T; position: TilePosition } => !!entry.position)
    .sort((a, b) => {
      const af = first?.(a.item) ? 0 : 1;
      const bf = first?.(b.item) ? 0 : 1;
      if (af !== bf) return af - bf;
      return a.position.y - b.position.y || a.position.x - b.position.x;
    });
  const fixed = new Map<T, PlacedTile<T>>();
  for (const { item, position } of positioned) {
    const size = sizeOf(item);
    const from = settleFrom?.(item) ?? position;
    const cell = scan(from, size);
    take(cell.x, cell.y, size);
    fixed.set(item, { item, x: cell.x, y: cell.y, size });
  }

  const placed: PlacedTile<T>[] = [];
  let floor = 0;
  for (const item of items) {
    const done = fixed.get(item);
    if (done) {
      placed.push(done);
      continue;
    }
    const size = sizeOf(item);
    if (breakBefore?.(item)) floor = occupied.length;
    const cell = scan({ x: 0, y: floor }, size);
    take(cell.x, cell.y, size);
    placed.push({ item, x: cell.x, y: cell.y, size });
  }
  return { placed, rows: occupied.length };
}

// Whether cell b comes after cell a in reading order - left to right, top
// to bottom - which is the order tiles flow in.
export function cellAfter(a: TilePosition, b: TilePosition): boolean {
  return b.y > a.y || (b.y === a.y && b.x > a.x);
}

export function tilesOverlap(a: PlacedTile<unknown>, b: PlacedTile<unknown>): boolean {
  return a.x < b.x + b.size.w && b.x < a.x + a.size.w && a.y < b.y + b.size.h && b.y < a.y + a.size.h;
}
