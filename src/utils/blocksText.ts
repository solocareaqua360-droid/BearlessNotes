import type { Block } from '../types';
import { displayValueOf, indentOf, listNumbers } from './documentBlocks';

// THE CHOSEN BLOCKS AS TEXT (2026-10-23, «Вирізати»/«Копіювати»): headings, lists, checkboxes, code, lines and tables keep
// their kind through the clipboard - utils/pasteBlocks reads exactly these marks - and a blank line stands between blocks.
// What cannot be text (a photo, a file, a note card, a record) is written as its name in brackets: outside the app that is
// what it reads as, and inside the app the paste is matched to the blocks themselves (utils/blockClipboard) and they come
// back whole.
export function blocksToMarkdown(
  blocks: Block[],
  // A .md FILE (2026-10-31, «експорт документа в md»): tables as Markdown tables (the clipboard keeps tabs, which a spreadsheet
  // pastes as cells), headings one level down (the note's title is the file's «#»), a picture or file named by its file.
  file?: { headingShift?: number; pipeTables?: boolean; assetPath?: (b: Block) => string | null }
): string {
  const out: string[] = [];
  // Step-aware numbering, and a sub-item two spaces in per step (Block.indent) - Markdown's own nesting.
  const numbers = listNumbers(blocks);
  blocks.forEach((b, index) => {
    const type = b.type ?? 'paragraph';
    const pad = '  '.repeat(indentOf(b));
    const text = b.text ?? '';
    switch (type) {
      case 'heading':
        out.push(`${'#'.repeat(Math.min(6, Math.max(1, (b.headingLevel ?? 2) + (file?.headingShift ?? 0))))} ${text}`);
        return;
      case 'bulleted':
        out.push(`${pad}- ${text}`);
        return;
      case 'numbered':
        out.push(`${pad}${numbers[index]}. ${text}`);
        return;
      case 'checkbox':
        out.push(`${pad}- [${b.checked ? 'x' : ' '}] ${text}`);
        return;
      case 'code':
        out.push(`\`\`\`${b.codeLanguage ?? ''}\n${text}\n\`\`\``);
        return;
      case 'divider':
        out.push('---');
        return;
      case 'table': {
        const rows = b.tableRows ?? [];
        if (file?.pipeTables && rows.length > 0) {
          const cell = (r: number, c: number) => displayValueOf(rows, r, c).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
          const lines = rows.map((row, r) => `| ${row.cells.map((_, c) => cell(r, c)).join(' | ')} |`);
          lines.splice(1, 0, `|${rows[0].cells.map(() => '---').join('|')}|`);
          out.push(lines.join('\n'));
          return;
        }
        out.push(rows.map((row, r) => row.cells.map((_, c) => displayValueOf(rows, r, c)).join('\t')).join('\n'));
        return;
      }
      case 'paragraph':
      case 'toggle':
        if (text) out.push(text);
        return;
      case 'image': {
        const path = file?.assetPath?.(b);
        out.push(path ? `![${b.imageTitle || 'Фото'}](${encodeURI(path)})` : b.imageTitle ? `[Фото: ${b.imageTitle}]` : '[Фото]');
        return;
      }
      case 'file': {
        const path = file?.assetPath?.(b);
        out.push(path ? `[${b.fileName || 'Файл'}](${encodeURI(path)})` : `[Файл: ${b.fileName || 'без назви'}]`);
        return;
      }
      case 'sketch':
        out.push('[Малюнок]');
        return;
      case 'dbTable':
        out.push('[Таблиця з бази]');
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

// A NOTE AS A .md FILE: its title as the «#», then its blocks (see blocksToMarkdown's `file`).
export function documentToMarkdown(title: string, blocks: Block[], assetPath?: (b: Block) => string | null): string {
  const body = blocksToMarkdown(blocks, { headingShift: 1, pipeTables: true, assetPath });
  return `# ${title.trim() || 'Без назви'}\n\n${body}\n`;
}
