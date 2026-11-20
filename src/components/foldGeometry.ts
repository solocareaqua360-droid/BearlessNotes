import { PAGE_SHEET_INSET } from './documentEditorStyles';
import { TOP_NAV_SPACE } from './TopNavBar';

// THE CARD-TO-PAGE MOVE, IN TRANSFORMS ONLY (2026-10-06). The page that
// grows out of its card (MorphFrame) and folds back into it (PageFold) was
// drawn by animating left/top/width/height - layout, which Reanimated can
// only apply by committing the shadow tree, and those commits wait while
// React is busy. Opening and closing a note are exactly when React is busy,
// so the move showed in two or three steps ("слайд-шоу, три кадри"; the
// phone's trace: 130-190 ms with no new frame in the middle of a 300 ms
// move). Transforms and the corner radius are applied straight on the UI
// thread, whatever React is doing.
//
// Same picture as before, frame by frame. The clip is a full-frame view
// scaled to the clip's rectangle (its overflow and corner do the cutting);
// the page inside it is scaled back the other way, so the net scale on the
// page is the one it always had and nothing is stretched.

// The card's corner on the phone (DocumentCard's grid tile).
export const CARD_RADIUS = 22;
// The editor's sheet's side inset on a phone.
const SHEET_X = PAGE_SHEET_INSET;
// The band above the title the card's picture does not have: the room kept
// clear for the capsules over the page (the sheet pads PAGE_HEADER_TOP +
// TOP_NAV_SPACE + 12, DocumentPageMiniature's band is PAGE_HEADER_TOP + 12).
// The card's corner stands on the line its picture starts on, and this band
// stays outside the clip.
const PAGE_BAND_EXTRA = TOP_NAV_SPACE;

// k: 0 in the card, 1 the whole frame. Frame size fw x fh; the card at
// (cx, cy) inside the frame, cw x ch; the sheet's top at sheetY.
export function foldTransforms(
  k: number,
  fw: number,
  fh: number,
  cx: number,
  cy: number,
  cw: number,
  ch: number,
  sheetY: number,
  // The card keeps its own line under the clip (utils/morph's band): the
  // clip's bottom then meets that line, so its bottom corners are square.
  squareBottom = false
) {
  'worklet';
  const xc = cx * (1 - k);
  const yc = cy * (1 - k);
  const wc = cw + (fw - cw) * k;
  const hc = ch + (fh - ch) * k;
  const sx = fw > 0 ? wc / fw : 1;
  const sy = fh > 0 ? hc / fh : 1;
  const sheetW = fw - SHEET_X * 2;
  const s0 = sheetW > 0 ? cw / sheetW : 1;
  const s = s0 + (1 - s0) * k;
  const left = -SHEET_X * s0 * (1 - k);
  const top = -(sheetY + PAGE_BAND_EXTRA) * s0 * (1 - k);
  // The corner as the eye sees it, in the scaled view's own units.
  const meanScale = (sx + sy) / 2;
  const radius = (CARD_RADIUS * (1 - k)) / (meanScale > 0 ? meanScale : 1);
  const bottomRadius = squareBottom ? 0 : radius;
  return {
    clip: {
      transform: [{ translateX: xc }, { translateY: yc }, { scaleX: sx }, { scaleY: sy }],
      borderTopLeftRadius: radius,
      borderTopRightRadius: radius,
      borderBottomLeftRadius: bottomRadius,
      borderBottomRightRadius: bottomRadius,
    },
    page: {
      transform: [
        { translateX: sx > 0 ? left / sx : 0 },
        { translateY: sy > 0 ? top / sy : 0 },
        { scaleX: sx > 0 ? s / sx : 1 },
        { scaleY: sy > 0 ? s / sy : 1 },
      ],
    },
  };
}
