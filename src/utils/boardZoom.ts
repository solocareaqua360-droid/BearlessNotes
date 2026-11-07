import { measureCard, type Rect } from './morph';

// A BOARD OPENS BY ZOOMING IN (EXPERIMENT, 2026-10-11, the user: «експеримент, майже впевнений, що
// естетично не вийде»; switch: FEATURES.boardZoom). A board is paper too, but it cannot unfold like a
// note, so its card ZOOMS: the real board screen stands scaled down in the card's rectangle and grows to
// the screen (components/BoardZoomFrame); back, it shrinks into the card. The chrome (dock, top bar) is
// not carried - that is the part most likely to look wrong.

const from = new Map<string, Rect>();

export const boardZoomKey = (boardId: string) => `board:${boardId}`;

export function takeBoardZoomFrom(boardId: string): Rect | null {
  const rect = from.get(boardId) ?? null;
  from.delete(boardId);
  return rect;
}

export function openBoardZoomed(navigation: unknown, boardId: string): void {
  const nav = navigation as { navigate: (name: string, params?: object) => void };
  measureCard(boardZoomKey(boardId)).then((rect) => {
    if (!rect) {
      nav.navigate('BoardCopy', { boardId });
      return;
    }
    from.set(boardId, rect);
    nav.navigate('BoardCopy', { boardId, zoom: true });
  });
}
