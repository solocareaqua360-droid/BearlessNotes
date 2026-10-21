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
// The view a toggle is in, whichever way it was saved: two states, closed or open. (An older «first lines» block, saved as 'peek',
// reads as closed - that view was dropped on 2026-10-22 because it left the user unsure what was shown and what could be edited.)
export function foldOf(block: Block): 'closed' | 'open' {
  if (block.foldMode === 'closed' || block.foldMode === 'peek') return 'closed';
  if (block.foldMode === 'open') return 'open';
  return block.collapsed ? 'closed' : 'open';
}

// The toggle that HOLDS the block `id` (null for a toggle's own title, a block outside any toggle, or an unknown id).
export function ownerToggleId(blocks: Block[], id: string): string | null {
  const i = blocks.findIndex((b) => b.id === id);
  if (i <= 0) return null;
  if (blocks[i].type === 'toggle' || blocks[i].exitsToggle) return null;
  for (let k = i - 1; k >= 0; k--) {
    if (blocks[k].type === 'toggle') return blocks[k].id;
    if (blocks[k].exitsToggle) return null;
  }
  return null;
}

// `openId`: a toggle that is being WRITTEN IN shows everything it holds - the line the caret is on must never be hidden.
export function visibleBlocks(blocks: Block[], openId?: string | null): Block[] {
  if (!blocks.some((b) => b.type === 'toggle' && b.id !== openId && foldOf(b) === 'closed')) return blocks;
  const out: Block[] = [];
  let folded = false;
  for (const block of blocks) {
    if (block.type === 'toggle') {
      folded = block.id !== openId && foldOf(block) === 'closed';
      out.push(block);
      continue;
    }
    // Stepped back out before this block is drawn - it and everything after it show even while the toggle above stays closed.
    if (block.exitsToggle) folded = false;
    if (!folded) out.push(block);
  }
  return out;
}

// What a CLOSED toggle shows under its title: the first line of what it holds, faint, with «…» - a sign that something is inside
// (and no counter: a text note is not a table). Only for closed toggles that hold something with text.
export function foldHints(blocks: Block[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of blocks) {
    if (b.type !== 'toggle' || foldOf(b) !== 'closed') continue;
    const held = foldedUnder(blocks, b.id);
    const first = held.find((h) => (h.text ?? '').replace(/\{[^}]*\}|\*|_|~/g, '').trim() !== '');
    if (!first) continue;
    const plain = (first.text ?? '').replace(/\{[^}]*\}|\*\*|\*|__|~~/g, '').replace(/\s+/g, ' ').trim();
    out.set(b.id, `${plain.length > 60 ? plain.slice(0, 60).trimEnd() : plain}…`);
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
    if (block.type === 'toggle' && foldOf(block) === 'closed') pending = hiddenOf(block);
  }
  out.push(...pending);
  return out;
}
