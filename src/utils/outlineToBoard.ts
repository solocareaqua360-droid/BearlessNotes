import { generateId } from './documentBlocks';
import type { BoardCard, BoardConnection } from '../types';

// «КАРТА З ТЕКСТУ» (2026-10-11): a tree of ideas written as text - what an AI answers when asked for
// a mind map - becomes cards joined by lines on a board. The format asked of the AI is Markdown
// HEADINGS: the heading is the card's title, the paragraph under it the card's text, the number of
// `#` the depth, the parent the nearest heading above with fewer `#`.
//
//   # Подорож
//   Десять днів у травні.
//   ## Маршрут
//   Три міста потягом.
//   ### Рим
//   Два дні.
//
// A plain INDENTED list (no `#` at all) is understood too - each line a title, the indent the depth.

export type OutlineNode = { title: string; body: string; depth: number; parent: number | null };

export function parseOutline(raw: string): OutlineNode[] {
  // A fenced block (the AI was asked to answer inside one) is unwrapped.
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*```[a-zA-Z]*\n/, '')
    .replace(/\n```\s*$/, '');
  const lines = text.split('\n');
  const hasHeadings = lines.some((l) => /^\s{0,3}#{1,6}\s+\S/.test(l));
  const nodes: OutlineNode[] = [];
  const stack: { depth: number; index: number }[] = [];
  const add = (title: string, depth: number) => {
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].index : null;
    nodes.push({ title, body: '', depth, parent });
    stack.push({ depth, index: nodes.length - 1 });
  };
  if (hasHeadings) {
    for (const line of lines) {
      const m = line.match(/^\s{0,3}(#{1,6})\s+(.*\S)\s*$/);
      if (m) {
        add(clean(m[2]), m[1].length);
      } else if (nodes.length && line.trim()) {
        const last = nodes[nodes.length - 1];
        last.body = last.body ? `${last.body}\n${line.trim()}` : line.trim();
      }
    }
  } else {
    for (const line of lines) {
      if (!line.trim()) continue;
      const indent = (line.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '  ').length;
      const title = clean(line.trim().replace(/^([-*•]|\d+[.)])\s+/, ''));
      if (title) add(title, 1 + Math.floor(indent / 2));
    }
  }
  return nodes;
}

// Markdown the card would show as raw symbols.
function clean(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`/g, '').trim();
}

const CARD_W = 230;
const GAP_X = 90;
const GAP_Y = 22;
// Pastel by depth: the root stands out, each level has its own tint.
const TINTS = ['#FEF3C7', '#DBEAFE', '#DCFCE7', '#FCE7F3', '#EDE9FE', '#FFE4E6'];

// A card's drawn height is only known once it is drawn; this is near enough to keep neighbours apart.
function estimateHeight(node: OutlineNode): number {
  const lines = (s: string, per: number) => (s ? Math.ceil(s.length / per) : 0);
  return 40 + lines(node.title, 22) * 22 + (node.body ? 10 + lines(node.body, 30) * 19 : 0);
}

// The tree laid out left to right: the root at the left, each level a column to the right; leaves take
// one slot of their own, a parent stands at the middle of its children. Positions are the card's
// top-left, around `at`.
export function layoutOutline(
  nodes: OutlineNode[],
  at: { x: number; y: number },
  // Cards of one fixed height (note cards on a board have one), instead of the text-length estimate.
  fixedHeight?: number
): { x: number; y: number; width: number }[] {
  const children = new Map<number | null, number[]>();
  nodes.forEach((n, i) => children.set(n.parent, [...(children.get(n.parent) ?? []), i]));
  const top = new Array<number>(nodes.length).fill(0);
  const h = nodes.map((n) => fixedHeight ?? estimateHeight(n));
  let cursor = 0;
  const place = (i: number) => {
    const kids = children.get(i) ?? [];
    if (kids.length === 0) {
      top[i] = cursor;
      cursor += h[i] + GAP_Y;
      return;
    }
    kids.forEach(place);
    const first = top[kids[0]] + h[kids[0]] / 2;
    const last = top[kids[kids.length - 1]] + h[kids[kids.length - 1]] / 2;
    top[i] = (first + last) / 2 - h[i] / 2;
  };
  (children.get(null) ?? []).forEach(place);
  const total = Math.max(cursor - GAP_Y, 0);
  const minDepth = Math.min(...nodes.map((n) => n.depth));
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  // Centred on `at` sideways too, so the whole tree opens in view and not off to the right.
  const extent = (maxDepth - minDepth) * (CARD_W + GAP_X) + CARD_W;
  return nodes.map((n, i) => ({
    x: at.x - extent / 2 + (n.depth - minDepth) * (CARD_W + GAP_X),
    y: at.y - total / 2 + top[i],
    width: CARD_W,
  }));
}

export function tintOfDepth(depth: number, minDepth: number): string {
  return TINTS[(depth - minDepth) % TINTS.length];
}

export function outlineToBoard(
  nodes: OutlineNode[],
  at: { x: number; y: number }
): { cards: BoardCard[]; connections: BoardConnection[] } {
  const places = layoutOutline(nodes, at);
  const now = Date.now();
  const minDepth = Math.min(...nodes.map((n) => n.depth));
  const ids = nodes.map(() => generateId());
  const cards: BoardCard[] = nodes.map((n, i) => ({
    id: ids[i],
    type: 'paragraph',
    text: n.body ? `**${n.title}**\n${n.body}` : `**${n.title}**`,
    createdAt: now,
    ...places[i],
    color: tintOfDepth(n.depth, minDepth),
  }));
  const connections: BoardConnection[] = [];
  nodes.forEach((n, i) => {
    if (n.parent !== null) connections.push({ id: generateId(), fromCardId: ids[n.parent], toCardId: ids[i], kind: 'arrow' });
  });
  return { cards, connections };
}
