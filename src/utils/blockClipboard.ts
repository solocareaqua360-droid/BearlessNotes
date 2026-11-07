import type { Block } from '../types';
import { clippedBlock } from './copyToNote';

// BLOCKS COPIED OR CUT WHOLE (2026-10-23, the user: «копіювання повинно бути цілісним блоком»). The system clipboard can hold
// only text, so it gets the blocks as text (utils/blocksText) and the blocks themselves are kept here. A paste whose text is
// exactly that text is these blocks again - a note card stays a card, a photo the same photo, a table a table. Anything
// copied elsewhere afterwards no longer matches, and pastes as text as before.
type Held = { text: string; blocks: Block[]; cut: boolean };
let held: Held | null = null;

export function holdBlocks(text: string, blocks: Block[], cut: boolean) {
  held = { text: text.trim(), blocks: blocks.map((b) => ({ ...b })), cut };
}

// The blocks for a pasted piece, ready to insert. A cut is MOVED by its first paste (its ids kept, so the photo and file
// records that point at them keep pointing); every other paste is a copy with fresh ids, the way «В нотатку» copies.
export function takeHeldBlocks(piece: string): Block[] | null {
  if (!held || piece.trim() !== held.text) return null;
  const moving = held.cut;
  held.cut = false;
  return held.blocks.map((b) => {
    const { exitsToggle: _side, ...rest } = clippedBlock(b, moving);
    return rest as Block;
  });
}
