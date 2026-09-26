import type { Block } from '../types';

// WHAT A FOLDED PAGE SHOWS, in one place.
//
// A 'toggle' block folds everything after it until the next toggle, or
// the end of the note - or until a block marked `exitsToggle`, the one
// way out of that rule (see isUnderToggle below). That rule has to be
// the same everywhere a note is drawn - the editor, a card that IS that
// page made small, the day's own miniature on the calendar - or a card
// would show what its page hides, and the two would stop being the same
// picture.
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
    // Stepped back out before this block is drawn - it and everything
    // after it show even while the toggle above stays collapsed.
    if (block.exitsToggle) folded = false;
    if (!folded) out.push(block);
  }
  return out;
}

// Whether the block at `index` is currently owned by SOME toggle -
// ownership, not visibility, so it does not care whether that toggle
// happens to be collapsed right now. Answers, for one position, the same
// question visibleBlocks answers for the whole list: is this where an
// empty line's own Backspace should step back out, rather than delete
// the line the way it does everywhere else in the note.
export function isUnderToggle(blocks: Block[], index: number): boolean {
  let under = false;
  for (let i = 0; i < index; i++) {
    if (blocks[i].type === 'toggle') under = true;
    else if (blocks[i].exitsToggle) under = false;
  }
  return under;
}

// The blocks a toggle is holding down right now - what has to travel with
// it when it is dragged, and what comes back when it is opened. Stops at
// an `exitsToggle` block the same way it stops at the next toggle: past
// that point nothing is folded, so nothing there needs to be carried.
export function foldedUnder(blocks: Block[], toggleId: string): Block[] {
  const start = blocks.findIndex((b) => b.id === toggleId);
  if (start === -1) return [];
  const held: Block[] = [];
  for (let i = start + 1; i < blocks.length; i++) {
    if (blocks[i].type === 'toggle' || blocks[i].exitsToggle) break;
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
