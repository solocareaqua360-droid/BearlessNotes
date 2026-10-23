import type { Block, BoardCard, BoardConnection } from '../types';

// ONE TREE FOR THE AI (2026-10-24). A note and a board show the same content two ways, and the AI must
// never be handed whatever the user happened to type - only a tree the app has made, so that nothing the
// user does can break what the AI reads. The mapping is TOTAL: every document and every board, however
// untidy, becomes a valid tree (one parent per node, no cycle, nothing lost, the same answer every time).
//
//   document: a heading is a node; its depth is its place in the tree, not its `#` count (a skipped level
//             just nests); every other block belongs to the nearest heading above it; blocks before the
//             first heading belong to a root made for them.
//   board:    an arrow runs parent -> child; a plain line or a double arrow has no direction, so the card
//             further left (then higher) is the parent. A card with several parents keeps the first and
//             names the others as «див. також»; a loop is cut at its first card; a card with no line at
//             all goes under «Без зв'язків».

export type StructNode = {
  id: string;
  title: string;
  // The text of the node, as lines. For a document it is read off the blocks under the heading.
  body: string[];
  parent: string | null;
  depth: number;
  // Other nodes this one also hangs from (a second parent), by id.
  seeAlso: string[];
  // The cards this one points at that are NOT its children (they hang from an older parent): a card made to gather
  // «теми на сьогодні» from a tree. By id.
  refs?: string[];
  // Made by the mapping itself («Без зв'язків», the root of a note's leading text) - not stored anywhere.
  synthetic?: boolean;
};

// Markdown has six heading levels, so the AI's text cannot show a tree deeper than six. Anything deeper is
// lifted to hang from its depth-5 ancestor (a sibling of the depth-6 nodes); nothing is dropped.
const MAX_DEPTH = 6;
function capDepth(nodes: StructNode[]): StructNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n.parent === null) continue;
    const p = byId.get(n.parent)!;
    n.depth = p.depth + 1;
    if (n.depth > MAX_DEPTH) {
      let a: StructNode = p;
      while (a.depth > MAX_DEPTH - 1 && a.parent !== null) a = byId.get(a.parent)!;
      n.parent = a.id;
      n.depth = a.depth + 1;
    }
  }
  return nodes;
}

export const UNLINKED_TITLE = "Без зв'язків";

const KIND_LABEL: Record<string, string> = {
  image: 'зображення',
  file: 'файл',
  link: 'посилання',
  sketch: 'малюнок',
  table: 'таблиця',
  divider: '',
  dbRow: 'запис бази',
  flashcard: 'картка',
};

function lineOfBlock(b: Block): string[] {
  const type = b.type ?? 'paragraph';
  if (type in KIND_LABEL) {
    const label = KIND_LABEL[type];
    if (!label) return [];
    const named = (b.imageTitle || b.fileTitle || b.linkTitle || '').trim();
    return [named ? `[${label}: ${named}]` : `[${label}]`];
  }
  const prefix = type === 'bulleted' ? '- ' : type === 'numbered' ? '1. ' : type === 'checkbox' ? '- [ ] ' : '';
  return (b.text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => (i === 0 ? prefix + l : l));
}

// A document, read as a tree. `rootTitle` names the root made for text that comes before the first heading.
export function blocksToStructure(blocks: Block[], rootTitle = ''): StructNode[] {
  const nodes: StructNode[] = [];
  const stack: { level: number; index: number }[] = [];
  let leading: string[] = [];
  const hasLeading = () => leading.length > 0;
  const startRoot = () => {
    nodes.push({ id: 'note-root', title: rootTitle || 'Нотатка', body: leading, parent: null, depth: 1, seeAlso: [], synthetic: true });
    stack.push({ level: 0, index: 0 });
    leading = [];
  };
  let current = -1;
  for (const b of blocks) {
    if ((b.type ?? 'paragraph') === 'heading') {
      if (hasLeading() && nodes.length === 0) startRoot();
      const level = Math.min(Math.max(b.headingLevel ?? 1, 1), 6);
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack.length ? nodes[stack[stack.length - 1].index] : null;
      nodes.push({
        id: b.id,
        title: (b.text ?? '').replace(/\s+/g, ' ').trim() || 'Без назви',
        body: [],
        parent: parent ? parent.id : null,
        depth: parent ? parent.depth + 1 : 1,
        seeAlso: [],
      });
      stack.push({ level, index: nodes.length - 1 });
      current = nodes.length - 1;
      continue;
    }
    const lines = lineOfBlock(b);
    if (current === -1 && nodes.length === 0) leading.push(...lines);
    else if (current === -1) nodes[0].body.push(...lines);
    else nodes[current].body.push(...lines);
  }
  if (nodes.length === 0 && hasLeading()) startRoot();
  return capDepth(nodes);
}

function sortKey(c: BoardCard): [number, number, string] {
  return [c.x ?? 0, c.y ?? 0, c.id];
}
function byPlace(a: BoardCard, b: BoardCard): number {
  const [ax, ay, ai] = sortKey(a);
  const [bx, by, bi] = sortKey(b);
  return ax - bx || ay - by || (ai < bi ? -1 : ai > bi ? 1 : 0);
}
// Reading order for siblings: top to bottom, then left to right.
function byReading(a: BoardCard, b: BoardCard): number {
  const [ax, ay, ai] = sortKey(a);
  const [bx, by, bi] = sortKey(b);
  return ay - by || ax - bx || (ai < bi ? -1 : ai > bi ? 1 : 0);
}

function cardText(c: BoardCard): { title: string; body: string[] } {
  if (c.type === 'document' || c.type === 'board') {
    const title = (c.type === 'board' ? c.boardTitle : c.documentTitle) || 'Без назви';
    return { title: title.replace(/\s+/g, ' ').trim(), body: (c.documentPreviewText ?? '').split('\n').map((l) => l.trim()).filter(Boolean) };
  }
  const raw = lineOfBlock(c as unknown as Block);
  if (raw.length === 0) return { title: 'Без назви', body: [] };
  // A sticky made from an outline is «**Title**» then the text; any other card: its first line is the title.
  const first = raw[0].replace(/^\*\*(.+?)\*\*$/, '$1').replace(/\s+/g, ' ').trim();
  return { title: first.length > 80 ? `${first.slice(0, 77)}…` : first || 'Без назви', body: raw.slice(1) };
}

// A board, read as a tree.
export function boardToStructure(cards: BoardCard[], connections: BoardConnection[]): StructNode[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  // Directed edges parent -> child, between cards that exist, never a card to itself, never a copy to its original.
  const edges: [string, string, string][] = [];
  for (const k of connections) {
    const a = byId.get(k.fromCardId);
    const b = byId.get(k.toCardId);
    if (!a || !b || a.id === b.id) continue;
    if (a.copyOf === b.id || b.copyOf === a.id) continue;
    if (k.kind === 'arrow') edges.push([a.id, b.id, k.id]);
    else edges.push(byPlace(a, b) <= 0 ? [a.id, b.id, k.id] : [b.id, a.id, k.id]);
  }
  const linked = new Set<string>();
  edges.forEach(([p, c]) => { linked.add(p); linked.add(c); });
  // The OLDEST arrow into a card is its parent (a line's id starts with the time it was drawn): the skeleton of a tree is
  // drawn first, and a card made later that points at several of its cards («теми на сьогодні») must not become their
  // parent - those arrows stay as «див. також». Ties go by place.
  const parentOf = new Map<string, string>();
  const alsoOf = new Map<string, string[]>();
  const refsOf = new Map<string, string[]>();
  const sortedEdges = [...edges].sort((e1, e2) => (e1[2] < e2[2] ? -1 : e1[2] > e2[2] ? 1 : 0) || byPlace(byId.get(e1[0])!, byId.get(e2[0])!) || (e1[1] < e2[1] ? -1 : e1[1] > e2[1] ? 1 : 0));
  for (const [p, c] of sortedEdges) {
    if (!parentOf.has(c)) parentOf.set(c, p);
    else if (parentOf.get(c) !== p) {
      alsoOf.set(c, [...(alsoOf.get(c) ?? []), p]);
      refsOf.set(p, [...(refsOf.get(p) ?? []), c]);
    }
  }
  // A loop is cut at its first card (by place): that card becomes a root.
  const cut = new Set<string>();
  for (const start of [...parentOf.keys()].sort((x, y) => byPlace(byId.get(x)!, byId.get(y)!))) {
    const seen: string[] = [];
    let at: string | undefined = start;
    while (at !== undefined && !cut.has(at) && !seen.includes(at)) {
      seen.push(at);
      at = parentOf.get(at);
    }
    if (at !== undefined && seen.includes(at)) {
      const loop = seen.slice(seen.indexOf(at));
      const first = loop.sort((x, y) => byPlace(byId.get(x)!, byId.get(y)!))[0];
      parentOf.delete(first);
      cut.add(first);
    }
  }
  const kids = new Map<string | null, BoardCard[]>();
  for (const c of cards) {
    if (!linked.has(c.id)) continue;
    const p = parentOf.get(c.id) ?? null;
    kids.set(p, [...(kids.get(p) ?? []), c]);
  }
  kids.forEach((list) => list.sort(byReading));
  const out: StructNode[] = [];
  const walk = (c: BoardCard, parent: string | null, depth: number) => {
    const { title, body } = cardText(c);
    const refs = (refsOf.get(c.id) ?? []).filter((id) => parentOf.get(id) !== c.id);
    out.push({ id: c.id, title, body, parent, depth, seeAlso: alsoOf.get(c.id) ?? [], ...(refs.length ? { refs } : {}) });
    (kids.get(c.id) ?? []).forEach((k) => walk(k, c.id, depth + 1));
  };
  (kids.get(null) ?? []).forEach((r) => walk(r, null, 1));
  const loose = cards.filter((c) => !linked.has(c.id)).sort(byReading);
  if (loose.length) {
    out.push({ id: 'board-unlinked', title: UNLINKED_TITLE, body: [], parent: null, depth: 1, seeAlso: [], synthetic: true });
    loose.forEach((c) => walk(c, 'board-unlinked', 2));
  }
  return capDepth(out);
}

// The text the AI reads: Markdown headings (depth = number of `#`), the node's lines under each. It is the
// format outlineToBoard.parseOutline reads back, so what the AI writes in answer goes through the same door.
export function structureToOutline(nodes: StructNode[], options: { seeAlso?: boolean } = {}): string {
  const title = new Map(nodes.map((n) => [n.id, n.title]));
  const out: string[] = [];
  for (const n of nodes) {
    out.push(`${'#'.repeat(Math.min(n.depth, 6))} ${n.title.replace(/^#+\s*/, '').trim() || 'Без назви'}`);
    for (const line of n.body) out.push(/^\s{0,3}#/.test(line) ? `\\${line.trimStart()}` : line);
    if (options.seeAlso !== false && n.refs?.length) {
      out.push(`→ збирає з інших гілок: ${n.refs.map((id) => title.get(id) ?? '').filter(Boolean).join('; ')}`);
    }
    if (options.seeAlso !== false && n.seeAlso.length) {
      out.push(`↔ див. також: ${n.seeAlso.map((id) => title.get(id) ?? '').filter(Boolean).join('; ')}`);
    }
  }
  return out.join('\n');
}
