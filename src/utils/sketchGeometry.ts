import type { SketchElement, SketchPathElement, SketchShape } from '../types';

// The geometry a drawing is measured and changed with - shared by the
// editor and every place that shows a drawing, so "where the drawing is"
// means one thing.

export type Point = { x: number; y: number };
export type Box = { minX: number; minY: number; maxX: number; maxY: number };

export function pointsToPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

// Every element's `d` is built from plain M/L segments only (no arcs, no
// curves) - that keeps one parser good for every hit test the editor does:
// erasing, selecting, and bounding boxes. An M starts a new run, which is
// how an arrow's head is a separate stroke inside the same path.
export function parsePathPoints(d: string): Point[] {
  return parsePathRuns(d).flat();
}
export function parsePathRuns(d: string): Point[][] {
  const runs: Point[][] = [];
  d.split(/(?=[ML])/)
    .filter(Boolean)
    .forEach((segment) => {
      const [x, y] = segment.slice(1).trim().split(' ').map(Number);
      if (segment[0] === 'M' || runs.length === 0) runs.push([]);
      runs[runs.length - 1].push({ x, y });
    });
  return runs;
}
function runsToPath(runs: Point[][]): string {
  return runs.map((run) => pointsToPath(run)).join(' ');
}

// A shape is stored by its two defining points (plus its kind) rather than
// only as a finished path, so it can still be moved and resized afterwards
// - `d` is just regenerated from them each time.
export function shapeToPath(shape: SketchShape, strokeWidth: number): string {
  const { kind, x1, y1, x2, y2 } = shape;
  if (kind === 'line') return `M${x1} ${y1} L${x2} ${y2}`;
  if (kind === 'arrow') {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(14, strokeWidth * 4);
    const spread = Math.PI / 7;
    const hx1 = x2 - head * Math.cos(angle - spread);
    const hy1 = y2 - head * Math.sin(angle - spread);
    const hx2 = x2 - head * Math.cos(angle + spread);
    const hy2 = y2 - head * Math.sin(angle + spread);
    return `M${x1} ${y1} L${x2} ${y2} M${hx1} ${hy1} L${x2} ${y2} L${hx2} ${hy2}`;
  }
  if (kind === 'rect') {
    return `M${x1} ${y1} L${x2} ${y1} L${x2} ${y2} L${x1} ${y2} L${x1} ${y1}`;
  }
  // Circles and ellipses as 48-sided polygons rather than true SVG arcs:
  // visually the same at these stroke widths, and the path stays made of
  // plain points so the eraser and hit tests work on it unchanged.
  const cx = kind === 'circle' ? x1 : (x1 + x2) / 2;
  const cy = kind === 'circle' ? y1 : (y1 + y2) / 2;
  const rx = kind === 'circle' ? Math.hypot(x2 - x1, y2 - y1) || 1 : Math.abs(x2 - x1) / 2 || 1;
  const ry = kind === 'circle' ? rx : Math.abs(y2 - y1) / 2 || 1;
  const points: Point[] = [];
  for (let i = 0; i <= 48; i++) {
    const angle = (i / 48) * Math.PI * 2;
    points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return pointsToPath(points);
}

export function shapeElement(shape: SketchShape, color: string, width: number, rot?: number): SketchPathElement {
  return { kind: 'path', d: shapeToPath(shape, width), color, width, shape, ...(rot ? { rot } : {}) };
}

// ---- boxes ------------------------------------------------------------------

// The element's own box, as drawn before any turn.
export function boundsOf(el: SketchElement): Box {
  if (el.kind === 'image') return { minX: el.x, minY: el.y, maxX: el.x + el.w, maxY: el.y + el.h };
  if (el.kind === 'text') {
    const approxWidth = Math.max(el.text.length * el.fontSize * 0.55, 20);
    return { minX: el.x, minY: el.y - el.fontSize, maxX: el.x + approxWidth, maxY: el.y + el.fontSize * 0.25 };
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

// What an element turns about: the middle of its own box.
export function pivotOf(el: SketchElement): Point {
  const b = boundsOf(el);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function rotatePoint(p: Point, about: Point, deg: number): Point {
  if (!deg) return p;
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return { x: about.x + dx * cos - dy * sin, y: about.y + dx * sin + dy * cos };
}

// The four corners of the element's box, where they are on the page.
export function cornersOf(el: SketchElement): Point[] {
  const b = boundsOf(el);
  const pivot = pivotOf(el);
  const rot = el.rot ?? 0;
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ].map((p) => rotatePoint(p, pivot, rot));
}

// The upright box around the element as it lies on the page, turn and all.
export function worldBoundsOf(el: SketchElement): Box {
  if (!el.rot) return boundsOf(el);
  const c = cornersOf(el);
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function unionBox(boxes: Box[]): Box | null {
  let box: Box | null = null;
  for (const b of boxes) {
    if (![b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite)) continue;
    box = box
      ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) }
      : b;
  }
  return box;
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
  const box = unionBox(elements.map(worldBoundsOf));
  if (!box) return null;
  const x = box.minX - margin;
  const y = box.minY - margin;
  const width = Math.max(1, box.maxX - box.minX + margin * 2);
  const height = Math.max(1, box.maxY - box.minY + margin * 2);
  return { x, y, width, height, viewBox: `${x} ${y} ${width} ${height}`, aspect: width / height };
}

// ---- changing an element --------------------------------------------------

export function translateElement(el: SketchElement, dx: number, dy: number): SketchElement {
  if (el.kind === 'text' || el.kind === 'image') return { ...el, x: el.x + dx, y: el.y + dy };
  if (el.shape) {
    const s = el.shape;
    // Spread over the old one: its fill, outline and words go with it.
    return { ...el, ...shapeElement({ ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }, el.color, el.width, el.rot) };
  }
  const runs = parsePathRuns(el.d).map((run) => run.map((p) => ({ x: p.x + dx, y: p.y + dy })));
  return { ...el, d: runsToPath(runs) };
}

// Stretched in the element's OWN frame (before its turn) about `anchor`,
// then moved so that the anchor stays exactly where it was on the page -
// the box's middle moves when it is stretched, and the turn is about the
// middle, so without this a turned element would jump sideways.
export function scaleElement(el: SketchElement, sx: number, sy: number, anchor: Point): SketchElement {
  const scale = (p: Point) => ({ x: anchor.x + (p.x - anchor.x) * sx, y: anchor.y + (p.y - anchor.y) * sy });
  let next: SketchElement;
  if (el.kind === 'image') {
    const a = scale({ x: el.x, y: el.y });
    const b = scale({ x: el.x + el.w, y: el.y + el.h });
    next = { ...el, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(4, Math.abs(b.x - a.x)), h: Math.max(4, Math.abs(b.y - a.y)) };
  } else if (el.kind === 'text') {
    const k = Math.max(0.2, Math.abs(sy));
    const p = scale({ x: el.x, y: el.y });
    next = { ...el, x: p.x, y: p.y, fontSize: Math.max(6, el.fontSize * k) };
  } else if (el.shape) {
    const s = el.shape;
    let kind = s.kind;
    let a = scale({ x: s.x1, y: s.y1 });
    let b = scale({ x: s.x2, y: s.y2 });
    if (kind === 'circle') {
      // A stretched circle is an ellipse: kept as its box from here on.
      const r = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1;
      kind = 'ellipse';
      a = scale({ x: s.x1 - r, y: s.y1 - r });
      b = scale({ x: s.x1 + r, y: s.y1 + r });
    }
    next = { ...el, ...shapeElement({ kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y }, el.color, el.width, el.rot) };
  } else {
    const runs = parsePathRuns(el.d).map((run) => run.map(scale));
    next = { ...el, d: runsToPath(runs) };
  }
  if (!el.rot) return next;
  const before = rotatePoint(anchor, pivotOf(el), el.rot);
  const after = rotatePoint(anchor, pivotOf(next), el.rot);
  return translateElement(next, before.x - after.x, before.y - after.y);
}

// Turned by `deg` about a point on the page (its own middle, or the
// middle of everything chosen with it).
export function rotateElementAbout(el: SketchElement, deg: number, about: Point): SketchElement {
  const pivot = pivotOf(el);
  const moved = rotatePoint(pivot, about, deg);
  const turned = translateElement(el, moved.x - pivot.x, moved.y - pivot.y);
  const rot = normalizeDeg((el.rot ?? 0) + deg);
  const out = { ...turned } as SketchElement;
  if (rot) out.rot = rot;
  else delete out.rot;
  return out;
}

export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.abs(d) < 0.01 ? 0 : d;
}

// The SVG transform an element is drawn with, or undefined.
export function transformOf(el: SketchElement): string | undefined {
  if (!el.rot) return undefined;
  const p = pivotOf(el);
  return `rotate(${el.rot.toFixed(2)} ${p.x.toFixed(1)} ${p.y.toFixed(1)})`;
}

// A shape with an inside - one that can be filled and hold words.
export function isClosedShape(el: SketchElement): boolean {
  return el.kind === 'path' && !!el.shape && (el.shape.kind === 'rect' || el.shape.kind === 'circle' || el.shape.kind === 'ellipse');
}

// How strong a shape's fill is laid: a tint, the app's soft way with
// colour, so an outline and words on it still read.
export const FILL_OPACITY = 0.28;
export const LABEL_SIZE = 20;

// ---- ink ----------------------------------------------------------------------

// THE INK: the palette's first colour is the paper's own ink, not black.
// A drawing lies on the note's paper now (no white canvas of its own), and
// black strokes on the black theme's paper were invisible. Stored as the
// colour every drawing was always drawn in, so old drawings follow too.
export const INK = '#111827';
export function inkOn(color: string, paperInk: string): string {
  return color === INK ? paperInk : color;
}
