import { Block } from '../types';
import { plainTextOf } from './documentBlocks';

// A note's contents («Зміст», 2026-10-22): its headings in the order they stand, each with a depth - the editor's own «Заголовок 2 / 3 / 4»
// (headingLevel 1 / 2 / 3, a heading with none reads as 2) become depths 0 / 1 / 2. A heading with no words in it is not a
// section anyone could jump to, so it is left out.
export type OutlineItem = { id: string; text: string; depth: number };

export function noteOutline(blocks: Block[]): OutlineItem[] {
  const items: OutlineItem[] = [];
  for (const block of blocks) {
    if (block.type !== 'heading') continue;
    const text = plainTextOf(block.text ?? '').trim();
    if (!text) continue;
    items.push({ id: block.id, text, depth: Math.min(3, Math.max(1, block.headingLevel ?? 2)) - 1 });
  }
  return items;
}

// Which section the reader is in: the last heading that has already reached `line` (a y in the page's own coordinates, usually the scroll
// offset plus a margin). Before the first heading, the first one.
export function currentSection(items: OutlineItem[], offsetOf: (id: string) => number | null, line: number): string | null {
  let current: string | null = items[0]?.id ?? null;
  for (const item of items) {
    const y = offsetOf(item.id);
    if (y !== null && y <= line) current = item.id;
  }
  return current;
}
