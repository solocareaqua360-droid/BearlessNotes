import { useSyncExternalStore } from 'react';
import { ensureMainNote, mainNoteId } from './recordNotes';
import type { BoardCard, BoardColumn, BoardConnection, BoardContainer, BoardShape } from '../types';

// THE BOARD'S MAP («Карта дошки», 2026-10-22, the user: «бачити дошку й структурований текст одночасно»): one ordinary note bound to the
// board and kept out of every list, exactly like a record's technical note (an `owner` of kind 'board'; its id is rec_<boardId>, so it is found
// without a query and never made twice). What the map holds besides text: «ділянки» - a block that remembers a place on the board (centre and
// zoom) and a button that takes the board back there.
// `w`/`h`: how much of the board (in its own units) the screen showed then - what the picture of the place draws. Older lines have none.
export type BoardView = { boardId: string; x: number; y: number; scale: number; w?: number; h?: number };

export const mapDocIdOf = (boardId: string) => mainNoteId(boardId);

export function ensureBoardMap(boardId: string, boardTitle: string): Promise<string> {
  return ensureMainNote({ kind: 'board', id: boardId }, `Карта: ${boardTitle || 'дошка'}`);
}

// The jump travels from the button in the note (BlockRow) to the board on screen by a plain listener - the two know nothing of each other.
type Jump = (view: BoardView) => boolean;
const jumpers = new Set<Jump>();
export function onBoardJump(handler: Jump): () => void {
  jumpers.add(handler);
  return () => jumpers.delete(handler);
}
// True when a board that owns this view took it. False = no such board is open (the button then says so).
export function requestBoardJump(view: BoardView): boolean {
  let taken = false;
  jumpers.forEach((j) => {
    if (j(view)) taken = true;
  });
  return taken;
}

// THE PICTURE OF A PLACE is drawn, not photographed: the same miniature the boards list uses (BoardMiniMap), cropped to the saved region,
// from the board's own data - so it is never out of date with the cards, and costs no stored image. The board on screen hands its data over here.
export type BoardLive = {
  cards: BoardCard[];
  columns: BoardColumn[];
  connections: BoardConnection[];
  shapes: BoardShape[];
  containers: BoardContainer[];
  // The place on screen NOW - what «Оновити» takes.
  currentView: () => BoardView;
};
const live = new Map<string, BoardLive>();
const liveListeners = new Set<() => void>();
export function publishBoardLive(boardId: string, data: BoardLive | null) {
  if (data) live.set(boardId, data);
  else live.delete(boardId);
  liveListeners.forEach((l) => l());
}
export function useBoardLive(boardId: string): BoardLive | undefined {
  return useSyncExternalStore(
    (l) => {
      liveListeners.add(l);
      return () => {
        liveListeners.delete(l);
      };
    },
    () => live.get(boardId)
  );
}
export function currentBoardView(boardId: string): BoardView | null {
  return live.get(boardId)?.currentView() ?? null;
}
