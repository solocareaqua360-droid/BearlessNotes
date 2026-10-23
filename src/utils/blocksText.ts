import type { Block } from '../types';
import { displayValueOf } from './documentBlocks';

// THE CHOSEN BLOCKS AS TEXT (2026-10-23, «Вирізати»/«Копіювати»): headings, lists, checkboxes, code, lines and tables keep
// their kind through the clipboard - utils/pasteBlocks reads exactly these marks - and a blank line stands between blocks.
// What cannot be text (a photo, a file, a note card, a record) is written as its name in brackets: outside the app that is
// what it reads as, and inside the app the paste is matched to the blocks themselves (utils/blockClipboard) and they come
// back whole.
export function blocksToMarkdown(blocks: Block[]): string {
  const out: string[] = [];
  let number = 0;
  blocks.forEach((b) => {
    const type = b.type ?? 'paragraph';
    if (type !== 'numbered') number = 0;
    const text = b.text ?? '';
    switch (type) {
      case 'heading':
        out.push(`${'#'.repeat(Math.min(3, Math.max(1, b.headingLevel ?? 2)))} ${text}`);
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
      case 'image':
        out.push(b.imageTitle ? `[Фото: ${b.imageTitle}]` : '[Фото]');
        return;
      case 'file':
        out.push(`[Файл: ${b.fileName || 'без назви'}]`);
        return;
      case 'sketch':
        out.push('[Малюнок]');
        return;
      case 'docRef':
        out.push(`[Нотатка: ${b.docRefTitle || 'без назви'}]`);
        return;
      case 'link':
        out.push(b.linkUrl || `[Посилання: ${b.linkTitle || ''}]`);
        return;
      case 'dbRow':
        out.push(`[Запис: ${b.dbRowTitle || 'без назви'}]`);
        return;
      case 'dbView':
        out.push(`[Вигляд бази: ${b.dbViewTitle || ''}]`);
        return;
      case 'flashcard':
        out.push(`[Картка: ${b.flashcardTerm || ''}]`);
        return;
      default:
        return;
    }
  });
  return out.join('\n\n');
}
