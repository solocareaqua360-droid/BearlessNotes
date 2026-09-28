import { Block, CanvasLink } from '../types';

// Which arrows set the order, and which merely point.
//
// The user's way of never having to choose between parallel arrows: the
// FIRST arrow out of a card is the one that says what comes next, and
// the first arrow into a card is the one that says what came before.
// Every later arrow touching an already-taken end is auxiliary - drawn
// in another colour, read by the eye, ignored by the page. So the
// arrows that count always form plain chains, and a chain has one
// reading.
//
// "First" is creation order, which the ids carry: each begins with the
// moment it was made (see the editor's onToggleLink).
export function sequenceLinkIds(links: Record<string, CanvasLink>): Set<string> {
  const ordered = Object.entries(links).sort(([a], [b]) => a.localeCompare(b));
  const fromTaken = new Set<string>();
  const toTaken = new Set<string>();
  const primary = new Set<string>();
  for (const [id, link] of ordered) {
    if (link.from === link.to || fromTaken.has(link.from) || toTaken.has(link.to)) continue;
    fromTaken.add(link.from);
    toTaken.add(link.to);
    primary.add(id);
  }
  return primary;
}

// The page order the canvas's arrows ask for.
//
// The user's rule: an arrow from one card to another says "this one,
// then that one". Draw a chain and the page reads down the chain. The
// arrow has a direction - the card the hold (or the ring drag) started
// from is the FROM end, and that is what answers "which end is the
// beginning": a chain starts at the card nothing points at.
//
// The parts the rule does not say, decided here so they are decided
// once:
// - Only the arrows that SET the order count - see sequenceLinkIds; the
//   rest are for the eye. Those always form plain chains, so there is
//   no branch to choose between.
// - Several separate chains are read in the order of their starting
//   cards on the canvas, top to bottom (then left to right).
// - A loop (arrows that come back round) starts at its topmost card and
//   stops when it meets a card it has already read.
// - Cards no arrow touches keep the order they had, after every chain.
//   The arrows say something about the cards they join and nothing
//   about the rest, so the rest is left alone.
//
// Returns the SAME array when nothing would move, so a caller can tell
// "nothing to do" from "reordered" without comparing.
export function orderByCanvasLinks(blocks: Block[], links: Record<string, CanvasLink>): Block[] {
  const byId = new Map(blocks.map((b, index) => [b.id, { block: b, index }]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Set<string>();
  const primary = sequenceLinkIds(links);
  for (const [id, link] of Object.entries(links)) {
    if (!primary.has(id)) continue;
    if (!byId.has(link.from) || !byId.has(link.to) || link.from === link.to) continue;
    (outgoing.get(link.from) ?? outgoing.set(link.from, []).get(link.from)!).push(link.to);
    incoming.add(link.to);
  }
  if (outgoing.size === 0) return blocks;

  // Where a card sits, for "top to bottom": its canvas position when it
  // has been placed, and otherwise its place in the page, which is also
  // where the canvas draws it (down a column, in page order).
  function position(id: string): [number, number] {
    const entry = byId.get(id)!;
    const canvas = entry.block.canvas;
    return canvas ? [canvas.y, canvas.x] : [entry.index * 1000, 0];
  }
  function byPosition(a: string, b: string): number {
    const [ay, ax] = position(a);
    const [by, bx] = position(b);
    return ay - by || ax - bx;
  }

  const connected = new Set<string>([...outgoing.keys(), ...incoming]);
  const starts = Array.from(connected)
    .filter((id) => !incoming.has(id))
    .sort(byPosition);

  const order: string[] = [];
  const seen = new Set<string>();
  function read(id: string) {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const next of [...(outgoing.get(id) ?? [])].sort(byPosition)) read(next);
  }
  for (const id of starts) read(id);
  // A loop has no card nothing points at, so nothing above started it:
  // start it at its topmost card.
  for (const id of Array.from(connected).sort(byPosition)) read(id);

  const rest = blocks.filter((b) => !seen.has(b.id)).map((b) => b.id);
  const next = [...order, ...rest];
  if (next.every((id, index) => blocks[index].id === id)) return blocks;
  return next.map((id) => byId.get(id)!.block);
}

// The page as the canvas leaves it: what the arrows assembled first, then
// a line, then everything they did not touch. The user's words - text
// gets assembled and there turn out to be leftover pieces; the leftovers
// go under the line.
//
// The line is a real 'divider' block marked canvasDivider, so the page
// can do anything with it a divider allows - and so that leaving the
// canvas AGAIN finds the line it made last time and moves it, rather than
// adding a second under the first. Any such line is lifted out before the
// order is worked out, and put back only where the boundary now is; with
// nothing assembled, or nothing left over, there is no line at all.
//
// Same contract as orderByCanvasLinks: the SAME array when nothing would
// change.
export function assembleWithDivider(
  blocks: Block[],
  links: Record<string, CanvasLink>,
  makeDivider: () => Block
): Block[] {
  const withoutLine = blocks.filter((b) => !b.canvasDivider);
  const ordered = orderByCanvasLinks(withoutLine, links);
  const primary = sequenceLinkIds(links);
  const chained = new Set<string>();
  for (const [id, link] of Object.entries(links)) {
    if (!primary.has(id)) continue;
    if (withoutLine.some((b) => b.id === link.from) && withoutLine.some((b) => b.id === link.to)) {
      chained.add(link.from);
      chained.add(link.to);
    }
  }
  const assembledCount = ordered.filter((b) => chained.has(b.id)).length;
  const next =
    assembledCount > 0 && assembledCount < ordered.length
      ? [...ordered.slice(0, assembledCount), { ...makeDivider(), canvasDivider: true }, ...ordered.slice(assembledCount)]
      : ordered;
  // Unchanged means: the same blocks in the same order, and a divider
  // (if any) in the same place - its own id may differ, which is fine.
  const same =
    next.length === blocks.length &&
    next.every((b, index) => (b.canvasDivider ? !!blocks[index].canvasDivider : b.id === blocks[index].id));
  if (same) return blocks;
  return next.map((b, index) => (b.canvasDivider && blocks[index]?.canvasDivider ? blocks[index] : b));
}
