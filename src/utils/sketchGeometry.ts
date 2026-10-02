import type { SketchElement } from '../types';

// The geometry a drawing is measured with - shared by the editor and every
// place that shows a drawing, so "where the drawing is" means one thing.

export type Point = { x: number; y: number };
export type Box = { minX: number; minY: number; maxX: number; maxY: number };

// Every element's `d` is built from plain M/L segments only (no arcs, no
// curves) - that keeps one parser good for every hit test the editor does:
// erasing, selecting, and bounding boxes.
export function parsePathPoints(d: string): Point[] {
  return d
    .split(/(?=[ML])/)
    .filter(Boolean)
    .map((segment) => {
      const [x, y] = segment.slice(1).trim().split(' ').map(Number);
      return { x, y };
    });
}

export function boundsOf(el: SketchElement): Box {
  if (el.kind === 'text') {
    const approxWidth = Math.max(el.text.length * el.fontSize * 0.55, 20);
    return { minX: el.x, minY: el.y - el.fontSize, maxX: el.x + approxWidth, maxY: el.y };
  }
  const points = parsePathPoints(el.d);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  // Half the stroke on every side: a thick line's edge is past its points.
  const half = el.width / 2;
  return {
    minX: Math.min(...xs) - half,
    minY: Math.min(...ys) - half,
    maxX: Math.max(...xs) + half,
    maxY: Math.max(...ys) + half,
  };
}

// WHAT IS DRAWN, and only that: the box around every element with a small
// margin, as a viewBox. A drawing in a note is shown whole and cropped to
// it - "скільки намальовано скільки і показується" (2026-10-02) - so the
// empty canvas around it takes no room on the page, and the block's
// height follows the drawing. Read at display time, so drawings saved
// with a whole screen of empty canvas around them come out cropped too.
export const DRAWING_MARGIN = 16;
export function drawingViewBox(elements: SketchElement[], margin = DRAWING_MARGIN) {
  if (elements.length === 0) return null;
  let box: Box | null = null;
  for (const el of elements) {
    const b = boundsOf(el);
    if (![b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite)) continue;
    box = box
      ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) }
      : b;
  }
  if (!box) return null;
  const x = box.minX - margin;
  const y = box.minY - margin;
  const width = Math.max(1, box.maxX - box.minX + margin * 2);
  const height = Math.max(1, box.maxY - box.minY + margin * 2);
  return { x, y, width, height, viewBox: `${x} ${y} ${width} ${height}`, aspect: width / height };
}

// THE INK: the palette's first colour is the paper's own ink, not black.
// A drawing lies on the note's paper now (no white canvas of its own), and
// black strokes on the black theme's paper were invisible. Stored as the
// colour every drawing was always drawn in, so old drawings follow too.
export const INK = '#111827';
export function inkOn(color: string, paperInk: string): string {
  return color === INK ? paperInk : color;
}
