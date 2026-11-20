// THE PART OF A PICTURE A COVER SHOWS (2026-10-23, the user: «кадрування при застосуванні заставок... як в соцмережах... рамка,
// а ти просто рухаєш картинку або віддаляєш-наближаєш»; «єдиний модуль і потім імплементувати його всюди»).
//
// Not a cut copy: the same cover is drawn in boxes of different shapes (a note's band on a phone and on a Mac, a card, a
// miniature), and a copy cut for one would be wrong for the rest. What is kept is where the picture's centre of interest is
// and how close it is: the frame. Every box then fills itself the way `cover` does - only zoomed by `zoom` and centred on
// (cx, cy) as far as the picture's edges allow. The original stays whole, so the frame can always be changed.
export type ImageFrame = {
  // The point of the picture that stands in the middle of the box, as fractions of its width and height.
  cx: number;
  cy: number;
  // 1 = the picture just covers the box (as `cover`); 2 = twice as close.
  zoom: number;
  // The picture's own size, so a box can lay it out without reading the file first.
  w: number;
  h: number;
};

export const MAX_ZOOM = 5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Where the picture lies in a box of this size: its drawn size and its offset from the box's top left. The picture always
// covers the whole box - never a gap at an edge, however the frame was set.
export function framedRect(frame: ImageFrame, boxW: number, boxH: number): { width: number; height: number; left: number; top: number } {
  const s = Math.max(boxW / frame.w, boxH / frame.h) * clamp(frame.zoom, 1, MAX_ZOOM);
  const width = frame.w * s;
  const height = frame.h * s;
  const left = clamp(boxW / 2 - frame.cx * width, boxW - width, 0);
  const top = clamp(boxH / 2 - frame.cy * height, boxH - height, 0);
  return { width, height, left, top };
}

// A frame saved to a document: only plain numbers, rounded so a resave of the same frame is the same data.
export function cleanFrame(frame: ImageFrame): ImageFrame {
  const r = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
  return { cx: r(clamp(frame.cx, 0, 1)), cy: r(clamp(frame.cy, 0, 1)), zoom: r(clamp(frame.zoom, 1, MAX_ZOOM), 3), w: Math.round(frame.w), h: Math.round(frame.h) };
}
