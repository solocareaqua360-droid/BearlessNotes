import { ensureMainNote, mainNoteId } from './recordNotes';

// THE BOARD'S MAP («Карта дошки», 2026-10-22, the user: «бачити дошку й структурований текст одночасно»): one ordinary note bound to the
// board and kept out of every list, exactly like a record's technical note (an `owner` of kind 'board'; its id is rec_<boardId>, so it is found
// without a query and never made twice). What the map holds besides text: «ділянки» - a block that remembers a place on the board (centre and
// zoom) and a button that takes the board back there.
export type BoardView = { boardId: string; x: number; y: number; scale: number };

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
