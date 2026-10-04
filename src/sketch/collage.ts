import type { SketchCollageCell, SketchCollageElement } from './format';
import type { Point } from './sketchGeometry';

// A COLLAGE (склейка): one block on the canvas that holds a few pictures in
// a ready layout, with an even gap between them. It moves, turns and sizes
// as one; the pictures are arranged in its own window (CollageEditor).
//
// A layout is a tree of cuts: a cut is a divider that splits a space in two,
// at a ratio the user can drag. A leaf is a cell. The cells are the leaves
// in order (first side, then second), and the dividers are numbered in the
// same order - `splits[i]` is the ratio of the i-th divider.
export type Tree = null | { dir: 'v' | 'h'; r: number; a: Tree; b: Tree }; // 'v' = a vertical divider (two columns)

const v = (r: number, a: Tree, b: Tree): Tree => ({ dir: 'v', r, a, b });
const h = (r: number, a: Tree, b: Tree): Tree => ({ dir: 'h', r, a, b });
const _ = null;

export type CollageLayout = { id: string; n: number; tree: Tree };

export const LAYOUTS: CollageLayout[] = [
  { id: 'one', n: 1, tree: _ },
  { id: 'h2', n: 2, tree: v(0.5, _, _) },
  { id: 'v2', n: 2, tree: h(0.5, _, _) },
  { id: 'h2w', n: 2, tree: v(0.66, _, _) },
  { id: 'v2t', n: 2, tree: h(0.66, _, _) },
  { id: 'h3', n: 3, tree: v(1 / 3, _, v(0.5, _, _)) },
  { id: 'v3', n: 3, tree: h(1 / 3, _, h(0.5, _, _)) },
  { id: 'big2', n: 3, tree: v(0.6, _, h(0.5, _, _)) },
  { id: 'big2r', n: 3, tree: v(0.4, h(0.5, _, _), _) },
  { id: 'big2t', n: 3, tree: h(0.6, _, v(0.5, _, _)) },
  { id: 'big2b', n: 3, tree: h(0.4, v(0.5, _, _), _) },
  { id: 'grid4', n: 4, tree: h(0.5, v(0.5, _, _), v(0.5, _, _)) },
  { id: 'h4', n: 4, tree: v(0.25, _, v(1 / 3, _, v(0.5, _, _))) },
  { id: 'big3', n: 4, tree: v(0.6, _, h(1 / 3, _, h(0.5, _, _))) },
  { id: 'big3t', n: 4, tree: h(0.6, _, v(1 / 3, _, v(0.5, _, _))) },
  { id: 'g23', n: 5, tree: h(0.5, v(0.5, _, _), v(1 / 3, _, v(0.5, _, _))) },
  { id: 'g32', n: 5, tree: h(0.5, v(1 / 3, _, v(0.5, _, _)), v(0.5, _, _)) },
  { id: 'g6', n: 6, tree: h(0.5, v(1 / 3, _, v(0.5, _, _)), v(1 / 3, _, v(0.5, _, _))) },
  { id: 'g6b', n: 6, tree: v(0.5, h(1 / 3, _, h(0.5, _, _)), h(1 / 3, _, h(0.5, _, _))) },
];

export const MAX_PHOTOS = 6;

export const layoutsFor = (n: number) => LAYOUTS.filter((l) => l.n === n);

function row(n: number): Tree {
  // n cells in a row, equal - for a layout this version does not know.
  if (n <= 1) return null;
  return v(1 / n, null, row(n - 1));
}

// A layout this version does not know (a newer app made it), or one that no
// longer fits the number of cells: a plain row, so the pictures stay visible.
export function layoutOf(el: Pick<SketchCollageElement, 'layout' | 'cells'>): CollageLayout {
  const known = LAYOUTS.find((l) => l.id === el.layout);
  if (known && known.n === el.cells.length) return known;
  const n = Math.max(1, el.cells.length);
  return { id: el.layout, n, tree: row(n) };
}

export function defaultSplits(tree: Tree): number[] {
  if (!tree) return [];
  return [tree.r, ...defaultSplits(tree.a), ...defaultSplits(tree.b)];
}

export function currentSplits(el: SketchCollageElement): number[] {
  const base = defaultSplits(layoutOf(el).tree);
  return el.splits && el.splits.length === base.length ? el.splits : base;
}

export type Rect = { x: number; y: number; w: number; h: number };
export type Divider = { dir: 'v' | 'h'; index: number; rect: Rect; ratio: number; x1: number; y1: number; x2: number; y2: number };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const MIN_RATIO = 0.12;

// Every cell's rectangle and every divider, on the page (before any turn).
// The block's edge keeps `outer` clear; the two sides of a divider each
// leave half a `gap`.
export function solve(el: SketchCollageElement): { cells: Rect[]; dividers: Divider[] } {
  const tree = layoutOf(el).tree;
  const splits = currentSplits(el);
  const outer = clamp(el.outer ?? 0, 0, Math.min(el.w, el.h) / 3);
  const half = Math.max(0, el.gap) / 2;
  const cells: Rect[] = [];
  const dividers: Divider[] = [];
  let index = 0;
  const walk = (t: Tree, r: Rect) => {
    if (!t) {
      cells.push(r);
      return;
    }
    const i = index++;
    const ratio = clamp(splits[i] ?? t.r, MIN_RATIO, 1 - MIN_RATIO);
    if (t.dir === 'v') {
      const sx = r.x + r.w * ratio;
      dividers.push({ dir: 'v', index: i, rect: r, ratio, x1: sx, y1: r.y, x2: sx, y2: r.y + r.h });
      walk(t.a, { x: r.x, y: r.y, w: Math.max(1, sx - half - r.x), h: r.h });
      walk(t.b, { x: sx + half, y: r.y, w: Math.max(1, r.x + r.w - sx - half), h: r.h });
    } else {
      const sy = r.y + r.h * ratio;
      dividers.push({ dir: 'h', index: i, rect: r, ratio, x1: r.x, y1: sy, x2: r.x + r.w, y2: sy });
      walk(t.a, { x: r.x, y: r.y, w: r.w, h: Math.max(1, sy - half - r.y) });
      walk(t.b, { x: r.x, y: sy + half, w: r.w, h: Math.max(1, r.y + r.h - sy - half) });
    }
  };
  walk(tree, { x: el.x + outer, y: el.y + outer, w: Math.max(1, el.w - 2 * outer), h: Math.max(1, el.h - 2 * outer) });
  return { cells, dividers };
}

export const cellRects = (el: SketchCollageElement): Rect[] => solve(el).cells;

// `p` is a point in the block's own (unturned) frame.
export function cellIndexAt(el: SketchCollageElement, p: Point): number {
  return cellRects(el).findIndex((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
}

// Where the WHOLE picture is drawn for a cell, so that it covers the cell.
export function placement(cell: SketchCollageCell, rect: Rect): Rect {
  const cellAspect = rect.w / rect.h;
  const a = cell.aspect && cell.aspect > 0 ? cell.aspect : cellAspect;
  const zoom = Math.max(1, cell.zoom ?? 1);
  let w: number;
  let h2: number;
  if (a > cellAspect) {
    h2 = rect.h;
    w = h2 * a;
  } else {
    w = rect.w;
    h2 = w / a;
  }
  w *= zoom;
  h2 *= zoom;
  const fx = clamp(cell.fx ?? 0.5, rect.w / 2 / w, 1 - rect.w / 2 / w);
  const fy = clamp(cell.fy ?? 0.5, rect.h / 2 / h2, 1 - rect.h / 2 / h2);
  return { x: rect.x + rect.w / 2 - fx * w, y: rect.y + rect.h / 2 - fy * h2, w, h: h2 };
}
