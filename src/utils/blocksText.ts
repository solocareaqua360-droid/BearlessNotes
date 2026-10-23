import type { Block } from '../types';
import { displayValueOf } from './documentBlocks';

// THE CHOSEN BLOCKS AS TEXT THAT PASTES BACK AS BLOCKS (2026-10-23, «Вирізати»): headings, lists, checkboxes, code, lines and
// tables keep their kind through the clipboard - utils/pasteBlocks reads exactly these marks - and a blank line stands between
// blocks, so each one is pasted as a block of its own. Bold and italic keep their marks. What cannot be text (a picture, a file,
// a sketch) is left out.
export function blocksToMarkdown(blocks: Block[]): string {
  const out: string[] = [];
  let number = 0;
  blocks.forEach((b) => {
    const type = b.type ?? 'paragraph';
    if (type !== 'numbered') number = 0;
    const text = b.text ?? '';
    switch (type) {
      case 'heading':
        out.push(`${'#'.repeat(Math.min(3, Math.max(1, (b.headingLevel ?? 2) - 1)))} ${text}`);
        return;
      case 'bulleted':
        out.push(`- ${text}`);
        return;
      case 'numbered':
        number += 1;
        out.push(`${number}. ${text}`);
        return;
      case 'checkbox':
        out.push(`- [${b.checked ? 'x' : ' '}] ${text}`);
        return;
      case 'code':
        out.push(`\`\`\`${b.codeLanguage ?? ''}\n${text}\n\`\`\``);
        return;
      case 'divider':
        out.push('---');
        return;
      case 'table': {
        const rows = b.tableRows ?? [];
        out.push(rows.map((row, r) => row.cells.map((_, c) => displayValueOf(rows, r, c)).join('\t')).join('\n'));
        return;
      }
      case 'paragraph':
      case 'toggle':
        if (text) out.push(text);
        return;
      default:
        return;
    }
  });
  return out.join('\n\n');
}
