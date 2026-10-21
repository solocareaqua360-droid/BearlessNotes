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
// How many of a toggle's blocks the «peek» view shows under its title.
export const PEEK_BLOCKS = 3;

// The view a toggle is in, whichever way it was saved (older blocks only know `collapsed`).
export function foldOf(block: Block): 'closed' | 'peek' | 'open' {
  return block.foldMode ?? (block.collapsed ? 'closed' : 'open');
}

export function visibleBlocks(blocks: Block[]): Block[] {
  // Nothing folded is the common case, and it costs a single pass to
  // find out rather than a new array every render.
  if (!blocks.some((b) => b.type === 'toggle' && foldOf(b) !== 'open')) return blocks;
  const out: Block[] = [];
  let mode: 'closed' | 'peek' | 'open' = 'open';
  let shownHeld = 0;
  for (const block of blocks) {
    if (block.type === 'toggle') {
      mode = foldOf(block);
      shownHeld = 0;
      out.push(block);
      continue;
    }
    // Stepped back out before this block is drawn - it and everything
    // after it show even while the toggle above stays collapsed.
    if (block.exitsToggle) mode = 'open';
    if (mode === 'open') out.push(block);
    else if (mode === 'peek' && shownHeld < PEEK_BLOCKS) {
      shownHeld += 1;
      out.push(block);
    }
  }
  return out;
}

// The toggles in «peek» that are hiding something: the foot of their frame shows the sign that there is more.
export function peekMoreIds(blocks: Block[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'toggle' && foldOf(b) === 'peek' && foldedUnder(blocks, b.id).length > PEEK_BLOCKS) out.add(b.id);
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
  const seen = new Set(visibleOrder.map((b) => b.id));
  // A closed toggle's whole section follows it at once; a «peek» one keeps its visible blocks where the drag put them and
  // its hidden remainder follows the LAST of those, before whatever comes next (another toggle, a step out, the end).
  const hiddenOf = (toggle: Block) => foldedUnder(all, toggle.id).filter((b) => !seen.has(b.id));
  const out: Block[] = [];
  let pending: Block[] = [];
  for (const block of visibleOrder) {
    if (block.type === 'toggle' || block.exitsToggle) {
      out.push(...pending);
      pending = [];
    }
    out.push(block);
    if (block.type === 'toggle' && foldOf(block) !== 'open') pending = hiddenOf(block);
  }
  out.push(...pending);
  return out;
}
