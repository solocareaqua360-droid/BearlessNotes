// THE DRAWING FORMAT - shared with mindEva, which can import a drawing
// made here and edit it as one of its own (its note's sketch block).
//
// The element types below are mindEva's own (src/types.ts there), copied
// as they were when sketchEva was split off (2026-10-04). They are the
// CONTRACT between the two apps: change them only by ADDING (a new kind,
// a new optional field), never by renaming or removing, and record every
// change in docs/MINDEVA_COMPAT.md with whether mindEva can follow.

// One freehand stroke OR simple shape (line/rectangle/circle) in a
// 'sketch' block - `d` is a plain SVG path `d` attribute. A freehand
// stroke builds it up point-by-point while drawing; a shape computes it
// directly from its start/end points (a rectangle as a closed 4-point
// path, a circle as two arcs) - either way it's just a path to render,
// no separate shape-kind field needed.
// The two defining points of a simple shape, kept alongside the rendered
// path so the shape can still be moved/resized later - a freehand pen
// stroke has no such structure and is deliberately not movable.
export interface SketchShape {
  // 'ellipse' is a circle that has been stretched (its box, x1/y1 to
  // x2/y2, rather than a centre and a point on the rim).
  kind: 'line' | 'arrow' | 'rect' | 'circle' | 'ellipse';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SketchPathElement {
  kind: 'path';
  d: string;
  color: string;
  width: number;
  // Absent on freehand strokes, and dropped from a shape the eraser has
  // partly rubbed out (it's no longer a clean rectangle/circle).
  shape?: SketchShape;
  // Turned, in degrees, about the centre of its own box (sketchGeometry's
  // pivotOf). Absent: not turned.
  rot?: number;
  // A closed shape's inside (rect, circle, ellipse): its colour, laid as a
  // soft tint (SketchLayer's FILL_OPACITY). Absent: empty inside.
  fill?: string;
  // The outline switched off - a shape that is only its fill.
  noStroke?: boolean;
  // Words inside the shape, in its middle, turning with it.
  label?: string;
}

// A text label placed on a 'sketch' block's canvas.
export interface SketchTextElement {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
  rot?: number;
}

// A single drawn/placed thing on a 'sketch' block's canvas, in the order
// it was added - one flat, ordered list (rather than separate arrays per
// kind) so "undo" and z-order (a later element drawn on top of an
// earlier one) both just mean "look at the last item".
// A picture laid on a drawing (2026-10-02): from the phone's gallery or
// the «Зображення» database. One from the gallery is a copy of the drawing's
// own - kept in the cache and backed up to Drive like any attachment, but
// NOT made a record in «Зображення» ("зберігати в базі його не треба").
export interface SketchImageElement {
  kind: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  uri: string;
  driveFileId?: string;
  rot?: number;
}

export type SketchElement = SketchPathElement | SketchTextElement | SketchImageElement;

// A drawing as a file of its own (`*.sketch.json`) - what is saved here and
// what is exported to mindEva. `version` goes up with every change to the
// element types; a reader that meets a newer version still draws what it
// knows and keeps the rest untouched.
export const SKETCH_FORMAT = 'sketchEva';
export const SKETCH_VERSION = 1;

export type SketchFile = {
  format: typeof SKETCH_FORMAT;
  version: number;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  // The canvas the elements were drawn against (mindEva's sketchWidth /
  // sketchHeight).
  width: number;
  height: number;
  elements: SketchElement[];
  // Pictures inside the drawing, by the uri their image element carries:
  // base64 JPEG, so one file is the whole drawing. Filled on export.
  images?: Record<string, string>;
  // A finished picture of the whole drawing, base64 PNG - so an app that
  // cannot draw some newer element still shows the drawing. Filled on
  // export.
  preview?: string;
};
