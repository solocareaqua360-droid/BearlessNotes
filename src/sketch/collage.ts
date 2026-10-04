import type { SketchCollageCell, SketchCollageElement, SketchCrop } from './format';
import type { Point } from './sketchGeometry';

// A COLLAGE (склейка): one block on the canvas that holds a few pictures
// side by side, in a ready layout, with an even gap between them. It moves,
// turns and sizes as one. Each cell shows its picture "cover" - filling the
// cell - and the picture can be moved and zoomed inside its cell.
type Cell = [number, number, number, number]; // x, y, w, h as 0..1 of the block

export type CollageLayout = { id: string; label: string; aspect: number; cells: Cell[] };

export const LAYOUTS: CollageLayout[] = [
  { id: 'h2', label: '2 поруч', aspect: 3 / 2, cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
  { id: 'v2', label: '2 одна над одною', aspect: 2 / 3, cells: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
  { id: 'h3', label: '3 в ряд', aspect: 9 / 4, cells: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
  { id: 'v3', label: '3 стовпчиком', aspect: 4 / 9, cells: [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]] },
  { id: 'big2', label: 'Велике і два малих', aspect: 3 / 2, cells: [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]] },
  { id: 'grid4', label: 'Сітка 2×2', aspect: 1, cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
];

// A layout this version does not know (a newer app made it): one cell for
// every cell the block has, in a plain row - the pictures stay visible.
export function layoutOf(el: Pick<SketchCollageElement, 'layout' | 'cells'>): CollageLayout {
  const known = LAYOUTS.find((l) => l.id === el.layout);
  if (known && known.cells.length === el.cells.length) return known;
  const n = Math.max(1, el.cells.length);
  return { id: el.layout, label: '', aspect: n, cells: Array.from({ length: n }, (_, i) => [i / n, 0, 1 / n, 1] as Cell) };
}

export type Rect = { x: number; y: number; w: number; h: number };

// Each cell's rectangle on the page (before any turn): its share of the
// block, with half a gap taken off every side that touches another cell.
export function cellRects(el: SketchCollageElement): Rect[] {
  const half = Math.max(0, el.gap) / 2;
  return layoutOf(el).cells.map(([x, y, w, h]) => {
    const l = x < 0.001 ? 0 : half;
    const t = y < 0.001 ? 0 : half;
    const r = x + w > 0.999 ? 0 : half;
    const b = y + h > 0.999 ? 0 : half;
    return { x: el.x + x * el.w + l, y: el.y + y * el.h + t, w: Math.max(1, w * el.w - l - r), h: Math.max(1, h * el.h - t - b) };
  });
}

// `p` is a point in the block's own (unturned) frame.
export function cellIndexAt(el: SketchCollageElement, p: Point): number {
  return cellRects(el).findIndex((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Where the WHOLE picture is drawn for a cell, so that it covers the cell.
export function placement(cell: SketchCollageCell, rect: Rect): Rect {
  const cellAspect = rect.w / rect.h;
  const a = cell.aspect && cell.aspect > 0 ? cell.aspect : cellAspect;
  const zoom = Math.max(1, cell.zoom ?? 1);
  let w: number;
  let h: number;
  if (a > cellAspect) {
    h = rect.h;
    w = h * a;
  } else {
    w = rect.w;
    h = w / a;
  }
  w *= zoom;
  h *= zoom;
  const fx = clamp(cell.fx ?? 0.5, rect.w / 2 / w, 1 - rect.w / 2 / w);
  const fy = clamp(cell.fy ?? 0.5, rect.h / 2 / h, 1 - rect.h / 2 / h);
  return { x: rect.x + rect.w / 2 - fx * w, y: rect.y + rect.h / 2 - fy * h, w, h };
}

// The part of the picture a cell shows now, as a crop (for the cropping window).
export function cellCrop(cell: SketchCollageCell, rect: Rect): SketchCrop {
  const p = placement(cell, rect);
  return { x: (rect.x - p.x) / p.w, y: (rect.y - p.y) / p.h, w: rect.w / p.w, h: rect.h / p.h };
}

// ...and back: a crop with the cell's own shape becomes a focus and a zoom.
export function cellFromCrop(cell: SketchCollageCell, crop: SketchCrop, rect: Rect): SketchCollageCell {
  const cellAspect = rect.w / rect.h;
  const a = cell.aspect && cell.aspect > 0 ? cell.aspect : cellAspect;
  const fullShare = a > cellAspect ? cellAspect / a : 1; // the width share at zoom 1
  return { ...cell, fx: crop.x + crop.w / 2, fy: crop.y + crop.h / 2, zoom: Math.max(1, fullShare / Math.max(0.01, crop.w)) };
}
