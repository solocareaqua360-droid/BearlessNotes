import { createContext } from 'react';

// THE BOARD DRAWN INSIDE A WINDOW instead of as a screen of its own (the AI chat's draft board, 2026-10-24,
// components/ChatBoardWindow). Null everywhere else, and a null changes nothing in BoardScreen. When it is set, the
// board does the few things a full screen does that a window must not:
//  - it keeps the board out of the start desk's «recents» (noRecents);
//  - it uploads no preview picture on the way out (noPreviewCapture);
//  - a document card unfolds in place instead of opening the card window, which is laid out against the whole
//    screen (noCardWindow);
//  - it hands the selected card ids to the window, which draws its own bar over the board (onSelection);
//  - it re-reads the document cards' text when previewsTick changes - the board is not "focused" again the way
//    a screen is after an editor closes, so nothing else would tell it that a card's note changed.
export type BoardEmbed = {
  onSelection: (ids: string[], clear: () => void) => void;
  previewsTick: number;
  noRecents: boolean;
  noPreviewCapture: boolean;
  noCardWindow: boolean;
  // Opens fitted to ALL the cards, once (the AI chat's draft board).
  fitAll?: boolean;
  // Changes when the board is to be fitted to all its cards AGAIN (the AI added cards that may lie out of view).
  fitTick?: number;
};

export const BoardEmbedContext = createContext<BoardEmbed | null>(null);
