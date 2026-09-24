import type { Block } from '../types';

// WHAT A FOLDED PAGE SHOWS, in one place.
//
// A 'toggle' block folds everything after it until the next toggle, or
// the end of the note. That rule has to be the same everywhere a note is
// drawn - the editor, a card that IS that page made small, the day's own
// miniature on the calendar - or a card would show what its page hides,
// and the two would stop being the same picture.
export function visibleBlocks(blocks: Block[]): Block[] {
  // Nothing folded is the common case, and it costs a single pass to
  // find out rather than a new array every render.
  if (!blocks.some((b) => b.type === 'toggle' && b.collapsed)) return blocks;
  const out: Block[] = [];
  let folded = false;
  for (const block of blocks) {
    if (block.type === 'toggle') {
      folded = !!block.collapsed;
      out.push(block);
      continue;
    }
    if (!folded) out.push(block);
  }
  return out;
}

// The blocks a toggle is holding down right now - what has to travel with
// it when it is dragged, and what comes back when it is opened.
export function foldedUnder(blocks: Block[], toggleId: string): Block[] {
  const start = blocks.findIndex((b) => b.id === toggleId);
  if (start === -1) return [];
  const held: Block[] = [];
  for (let i = start + 1; i < blocks.length; i++) {
    if (blocks[i].type === 'toggle') break;
    held.push(blocks[i]);
  }
  return held;
}

// A reorder of what was ON SCREEN, put back over the whole note: every
// folded block follows the toggle it was under, wherever that toggle has
// gone. Dragged folded, a section moves as one thing - which is the only
// reading of it that is not a trap.
export function mergeVisibleOrder(all: Block[], visibleOrder: Block[]): Block[] {
  if (all.length === visibleOrder.length) return visibleOrder;
  const held = new Map<string, Block[]>();
  for (const block of visibleOrder) {
    if (block.type === 'toggle' && block.collapsed) held.set(block.id, foldedUnder(all, block.id));
  }
  const out: Block[] = [];
  for (const block of visibleOrder) {
    out.push(block);
    const under = held.get(block.id);
    if (under) out.push(...under);
  }
  return out;
}
