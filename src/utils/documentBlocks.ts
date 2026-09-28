import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Block, BlockType, TableRow } from '../types';
import { formatShortDate, parseDateKey } from './dateLocale';
import { photoWithSketchHtml, sketchToSvg } from './sketchSvg';
import { downloadToFolder } from './downloadToFolder';

// Pulled out of DocumentEditorScreen.tsx (2026-09-19), which had grown to
// 6883 lines - everything here is a pure function or a small constant, none
// of it closes over the screen's own state, so the move changes nothing at
// runtime. Shared by the screen itself and by the block-rendering
// components (BlockRow, TableBlockContent, ...) that also used to live in
// that one file.

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Firestore rejects `undefined` anywhere in a document, so every block is
// built through this one place instead of ad-hoc object literals scattered
// around - it never sets a field it doesn't need (checked only exists on
// checkbox blocks) rather than setting that field to undefined.
export function buildBlock(id: string, type: BlockType, text: string): Block {
  const block: Block = { id, text, type, createdAt: Date.now() };
  if (type === 'checkbox') block.checked = false;
  if (type === 'heading') block.headingLevel = 2;
  if (type === 'table') block.tableRows = [{ cells: ['', ''] }, { cells: ['', ''] }];
  return block;
}

export function newBlock(): Block {
  return buildBlock(generateId(), 'paragraph', '');
}

export const LIST_TYPES: BlockType[] = ['bulleted', 'numbered', 'checkbox'];

// Read-only mirror of TasksScreen's own formatReminderBadge - a checkbox
// block only ever displays its reminder here (editing happens from the
// Tasks screen, where the picker and the star/date rules live).
export function formatReminderBadge(item: Block): string | null {
  if (!item.reminderDate) return null;
  const label = formatShortDate(parseDateKey(item.reminderDate));
  return item.reminderTime ? `${label} ${item.reminderTime}` : label;
}

// A generic document icon, tinted per extension so a PDF/Word/Excel
// attachment is recognizable at a glance without needing per-brand icons.
// The ink on a sticker: the sticker is yellow in every theme, so this
// cannot follow the paper's ink.
export const STICKER_INK = '#111827';

export function fileIconFor(name?: string): 'document-text-outline' | 'document-outline' {
  return (name ?? '').toLowerCase().endsWith('.pdf') ? 'document-text-outline' : 'document-outline';
}

export function fileIconColorFor(name?: string): string {
  const ext = (name ?? '').toLowerCase().split('.').pop();
  if (ext === 'pdf') return '#DC2626';
  if (ext === 'doc' || ext === 'docx') return '#2563EB';
  if (ext === 'xls' || ext === 'xlsx') return '#16A34A';
  return '#6B7280';
}

// Saving a copy where the user can find it is the same job here as on
// the Photos and Files screens, and it is done in one place now - see
// utils/downloadToFolder, which also has a browser answer. This kept its
// own copy of that logic for a while, with one branch the shared one
// lacked and a folder key that happened to match; the two are one.
export async function downloadToDevice(sourceUri: string, fileName: string, mimeType: string): Promise<string | null> {
  return (await downloadToFolder(sourceUri, fileName, mimeType))?.destUri ?? null;
}

// Inline formatting is stored as plain markers inside the block's own text
// (**bold**, *italic*, __underline__, ~~strikethrough~~, {c:#hex}color{/c},
// {h:#hex}highlight{/h}) rather than a separate rich-text model.
//
// The user's own words: "Я не хочу бачити зірочки та всякі риски коли
// друкую, це мене збиває." The active field no longer shows the raw
// markers - it shows plainTextOf(text), the same marker-free string the
// locked block already displayed, and applyDisplayEdit turns whatever
// the OS reports back into the correct edit on the RAW text underneath.
// One real trade-off, taken deliberately over the alternative: a plain
// TextInput can only render ONE uniform style for its own value, so
// there is no LIVE bold-while-typing in the exact block you are editing
// - only the markers vanish, not the styling gap. Nested styled <Text>
// children inside an editable Android TextInput is the technique that
// would close that gap too, and it is known to be unreliable there
// (Expensify's own react-native-live-markdown exists because plain RN
// children were not enough for them either) - not attempted here. The
// moment a block is no longer the active one it renders through
// FormattedText exactly as it always did, bold and all.
export const COLOR_OPEN = /^\{c:(#[0-9A-Fa-f]{6})\}/;
export const HIGHLIGHT_OPEN = /^\{h:(#[0-9A-Fa-f]{6})\}/;
export const COLOR_CLOSE = '{/c}';
export const HIGHLIGHT_CLOSE = '{/h}';

export type TextStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  highlight?: string;
};

// rawStart: where this segment's text begins in the raw (marker-bearing)
// block text - what lets a position in the DISPLAYED text be mapped back
// to a cursor position in the TextInput, see rawIndexForDisplayIndex.
export type TextSegment = TextStyle & { text: string; rawStart: number };

export function parseFormattedText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  parseFormattedInto(text, {}, segments, 0);
  return segments;
}

// `base` is the raw-text index that `text[0]` sits at (this is called
// recursively on the inside of each marker pair).
function parseFormattedInto(text: string, style: TextStyle, out: TextSegment[], base: number) {
  let i = 0;
  let plainStart = 0;
  const flushPlain = (end: number) => {
    if (end > plainStart) out.push({ text: text.slice(plainStart, end), rawStart: base + plainStart, ...style });
  };
  while (i < text.length) {
    const rest = text.slice(i);
    let consumed = 0;
    if (rest.startsWith('**')) {
      const close = rest.indexOf('**', 2);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(2, close), { ...style, bold: true }, out, base + i + 2);
        consumed = close + 2;
      }
    } else if (rest.startsWith('__')) {
      const close = rest.indexOf('__', 2);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(2, close), { ...style, underline: true }, out, base + i + 2);
        consumed = close + 2;
      }
    } else if (rest.startsWith('~~')) {
      const close = rest.indexOf('~~', 2);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(2, close), { ...style, strikethrough: true }, out, base + i + 2);
        consumed = close + 2;
      }
    } else if (rest.startsWith('*')) {
      const close = rest.indexOf('*', 1);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(1, close), { ...style, italic: true }, out, base + i + 1);
        consumed = close + 1;
      }
    } else if (COLOR_OPEN.test(rest)) {
      const m = rest.match(COLOR_OPEN)!;
      const close = rest.indexOf(COLOR_CLOSE, m[0].length);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(m[0].length, close), { ...style, color: m[1] }, out, base + i + m[0].length);
        consumed = close + COLOR_CLOSE.length;
      }
    } else if (HIGHLIGHT_OPEN.test(rest)) {
      const m = rest.match(HIGHLIGHT_OPEN)!;
      const close = rest.indexOf(HIGHLIGHT_CLOSE, m[0].length);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(m[0].length, close), { ...style, highlight: m[1] }, out, base + i + m[0].length);
        consumed = close + HIGHLIGHT_CLOSE.length;
      }
    }
    if (consumed > 0) {
      i += consumed;
      plainStart = i;
    } else {
      i++;
    }
  }
  flushPlain(text.length);
}

// Same segments FormattedText renders on-screen, reused so an exported
// PDF keeps bold/italic/underline/strikethrough/color instead of showing
// the raw **markers**.
export function plainTextOf(text: string): string {
  return parseFormattedText(text)
    .map((s) => s.text)
    .join('');
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Cursor position in the raw text for a position in the displayed
// (marker-free) text. Past the end -> end of the raw text.
export function rawIndexForDisplayIndex(segments: TextSegment[], rawText: string, displayIndex: number): number {
  let displayStart = 0;
  for (const seg of segments) {
    if (displayIndex <= displayStart + seg.text.length) {
      return seg.rawStart + (displayIndex - displayStart);
    }
    displayStart += seg.text.length;
  }
  return rawText.length;
}

// One raw index per display character, PLUS one more for the position
// right after the last one - a "boundary" for every gap a caret or a
// selection edge can sit in, not just every character. parseFormattedText
// is exhaustive (every raw character ends up inside some segment's own
// text, markers included when unmatched), so this never has a gap: index
// `displayLength` always lands exactly on `rawText.length`.
export function displayBoundaries(rawText: string): number[] {
  const segments = parseFormattedText(rawText);
  const bounds: number[] = [];
  for (const seg of segments) {
    for (let k = 0; k < seg.text.length; k++) bounds.push(seg.rawStart + k);
  }
  bounds.push(rawText.length);
  return bounds;
}

// The other direction from rawIndexForDisplayIndex: where a raw position
// (the edge of a marker this screen just inserted or removed) lands in
// the display text that goes with it. Used to put the selection back in
// DISPLAY terms after applyMarkerToSelection/applyColorToSelection edit
// the raw text - the active field's own selection is always in display
// coordinates now, never raw.
export function displayIndexForRawIndex(rawText: string, rawIndex: number): number {
  const bounds = displayBoundaries(rawText);
  for (let i = 0; i < bounds.length; i++) {
    if (bounds[i] >= rawIndex) return i;
  }
  return bounds.length - 1;
}

// What the active field's own onChangeText turns into: not "the block's
// new text" directly, but the edit that produced it, replayed on the RAW
// text. The active field's value is plainTextOf(text) - marker-free - so
// what the OS hands back on every keystroke is a new DISPLAY string, and
// this is what turns that into the correct new RAW string underneath,
// using the same prefix/suffix diff insertedPiece uses for a paste, but
// with no length floor: a single typed or deleted character goes through
// here exactly the same as a whole pasted paragraph.
export function applyDisplayEdit(oldRawText: string, newDisplayText: string): string {
  const oldDisplayText = plainTextOf(oldRawText);
  if (oldDisplayText === newDisplayText) return oldRawText;
  const maxCommon = Math.min(oldDisplayText.length, newDisplayText.length);
  let prefix = 0;
  while (prefix < maxCommon && oldDisplayText[prefix] === newDisplayText[prefix]) prefix++;
  let suffix = 0;
  const maxSuffix = maxCommon - prefix;
  while (
    suffix < maxSuffix &&
    oldDisplayText[oldDisplayText.length - 1 - suffix] === newDisplayText[newDisplayText.length - 1 - suffix]
  ) {
    suffix++;
  }
  const removedEnd = oldDisplayText.length - suffix;
  const insertedText = newDisplayText.slice(prefix, newDisplayText.length - suffix);
  const bounds = displayBoundaries(oldRawText);
  const rawStart = bounds[prefix];
  const rawEnd = bounds[removedEnd];
  return oldRawText.slice(0, rawStart) + insertedText + oldRawText.slice(rawEnd);
}

// Tap-to-cursor for a locked block. Android gives no way to ask "which
// character is under this point" of a plain Text, so this estimates it from
// the line layout Text reports (onTextLayout): the LINE is exact (by y);
// the position within it is proportional to width, with a rough per-glyph
// weight so narrow letters/punctuation don't push the estimate right. Off
// by a character or so in practice - close enough that a second tap in the
// now-live input (which Android places exactly) is rarely needed.
export type TextLayoutLine = { text: string; x: number; y: number; width: number; height: number };

function segmentToHtml(seg: TextSegment): string {
  let html = escapeHtml(seg.text);
  if (seg.bold) html = `<b>${html}</b>`;
  if (seg.italic) html = `<i>${html}</i>`;
  if (seg.underline) html = `<u>${html}</u>`;
  if (seg.strikethrough) html = `<s>${html}</s>`;
  if (seg.highlight) html = `<span style="background:${seg.highlight}">${html}</span>`;
  if (seg.color) html = `<span style="color:${seg.color}">${html}</span>`;
  return html;
}

function textToHtml(text: string): string {
  return parseFormattedText(text).map(segmentToHtml).join('') || '&nbsp;';
}

function formatSum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// --- Table formulas -------------------------------------------------
// A cell's raw text is either a plain value or a formula starting with
// "=" that references other cells by A1-style address (e.g. "B3") or a
// rectangular range ("B1:B3"). Support is deliberately small: either a
// whole-cell SUM/AVERAGE/MIN/MAX/COUNT(range) call, or a plain
// arithmetic expression (+ - * / and parens) with cell refs substituted
// in - enough for "simple arithmetic, sum a column" without pulling in
// a real formula-language parser. No eval/new Function (Hermes doesn't
// reliably support dynamic code eval), so arithmetic is evaluated with
// a small hand-written recursive-descent parser.

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function columnIndexFromLetters(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(ref.trim());
  if (!m) return null;
  const row = parseInt(m[2], 10) - 1;
  if (row < 0) return null;
  return { row, col: columnIndexFromLetters(m[1]) };
}

function evaluateArithmetic(expr: string): number {
  let i = 0;
  const peek = () => expr[i];
  function parseNumber(): number {
    const start = i;
    while (i < expr.length && /[0-9.]/.test(expr[i])) i++;
    const n = parseFloat(expr.slice(start, i));
    return Number.isNaN(n) ? 0 : n;
  }
  function parseFactor(): number {
    while (peek() === ' ') i++;
    if (peek() === '(') {
      i++;
      const v = parseExpr();
      while (peek() === ' ') i++;
      if (peek() === ')') i++;
      return v;
    }
    if (peek() === '-') {
      i++;
      return -parseFactor();
    }
    if (peek() === '+') {
      i++;
      return parseFactor();
    }
    return parseNumber();
  }
  function parseTerm(): number {
    let v = parseFactor();
    for (;;) {
      while (peek() === ' ') i++;
      if (peek() === '*') {
        i++;
        v *= parseFactor();
      } else if (peek() === '/') {
        i++;
        const d = parseFactor();
        v = d !== 0 ? v / d : 0;
      } else break;
    }
    return v;
  }
  function parseExpr(): number {
    let v = parseTerm();
    for (;;) {
      while (peek() === ' ') i++;
      if (peek() === '+') {
        i++;
        v += parseTerm();
      } else if (peek() === '-') {
        i++;
        v -= parseTerm();
      } else break;
    }
    return v;
  }
  const result = parseExpr();
  return Number.isFinite(result) ? result : 0;
}

function evaluateRange(rangeExpr: string, rows: TableRow[], stack: Set<string>): number[] {
  const [fromRaw, toRaw] = rangeExpr.split(':');
  const from = parseCellRef(fromRaw ?? '');
  const to = parseCellRef((toRaw ?? fromRaw) ?? '');
  if (!from || !to) return [];
  const values: number[] = [];
  const rMin = Math.min(from.row, to.row);
  const rMax = Math.max(from.row, to.row);
  const cMin = Math.min(from.col, to.col);
  const cMax = Math.max(from.col, to.col);
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) values.push(evaluateCell(rows, r, c, stack));
  }
  return values;
}

function evaluateFormula(expr: string, rows: TableRow[], stack: Set<string>): number {
  const trimmed = expr.trim();
  const fnMatch = /^([A-Za-z]+)\(([^()]*)\)$/.exec(trimmed);
  if (fnMatch) {
    const fn = fnMatch[1].toUpperCase();
    const values = evaluateRange(fnMatch[2], rows, stack);
    if (fn === 'SUM') return values.reduce((a, b) => a + b, 0);
    if (fn === 'AVERAGE' || fn === 'AVG')
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    if (fn === 'MIN') return values.length ? Math.min(...values) : 0;
    if (fn === 'MAX') return values.length ? Math.max(...values) : 0;
    if (fn === 'COUNT') return values.length;
  }
  const substituted = trimmed.replace(/[A-Za-z]+[0-9]+/g, (ref) => {
    const parsed = parseCellRef(ref);
    if (!parsed) return '0';
    return String(evaluateCell(rows, parsed.row, parsed.col, stack));
  });
  return evaluateArithmetic(substituted);
}

// `stack` guards against a formula that (directly or transitively)
// references its own cell - without it a cycle would recurse forever.
function evaluateCell(rows: TableRow[], row: number, col: number, stack: Set<string>): number {
  const key = `${row}:${col}`;
  if (stack.has(key)) return 0;
  const raw = (rows[row]?.cells[col] ?? '').trim();
  if (!raw) return 0;
  if (raw.startsWith('=')) {
    stack.add(key);
    const result = evaluateFormula(raw.slice(1), rows, stack);
    stack.delete(key);
    return result;
  }
  const n = parseFloat(raw.replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}

export function displayValueOf(rows: TableRow[], row: number, col: number): string {
  const raw = rows[row]?.cells[col] ?? '';
  if (raw.trim().startsWith('=')) return formatSum(evaluateCell(rows, row, col, new Set()));
  return raw;
}

// Builds one self-contained HTML document from the title + blocks, for
// expo-print's HTML -> PDF (same approach as the scanner's own PDF
// assembly - no native module needed). Images are inlined as base64 data
// URIs since expo-print's WebView renderer can't reliably resolve local
// file:// paths; files/links/sketches fall back to a plain placeholder
// line rather than trying to render them.
export async function buildDocumentHtml(title: string, blocks: Block[]): Promise<string> {
  const parts: string[] = [];
  for (const block of blocks) {
    const type = block.type ?? 'paragraph';
    if (type === 'divider') {
      parts.push('<hr/>');
    } else if (type === 'checkbox') {
      const style = block.checked ? 'text-decoration:line-through;opacity:0.6;' : '';
      parts.push(`<p style="margin:4px 0;${style}">${block.checked ? '☑' : '☐'} ${textToHtml(block.text)}</p>`);
    } else if (type === 'bulleted') {
      parts.push(`<ul style="margin:2px 0;"><li>${textToHtml(block.text)}</li></ul>`);
    } else if (type === 'numbered') {
      parts.push(`<ol style="margin:2px 0;"><li>${textToHtml(block.text)}</li></ol>`);
    } else if (type === 'image' && block.imageUri) {
      try {
        const base64 = await LegacyFileSystem.readAsStringAsync(block.imageUri, { encoding: 'base64' });
        const img = `<img src="data:image/jpeg;base64,${base64}" style="max-width:100%;display:block;" />`;
        // A photograph the user has drawn over carries its drawing as a
        // layer of its own (never burnt into the file), so the export is
        // where the two are finally put together - the picture, and the
        // vectors over it in the same box.
        parts.push(
          photoWithSketchHtml(img, block.sketchElements, block.sketchWidth, block.sketchHeight)
        );
      } catch {
        parts.push('<p>[Зображення]</p>');
      }
    } else if (type === 'file') {
      parts.push(`<p>[Файл: ${escapeHtml(block.fileTitle || block.fileName || '')}]</p>`);
    } else if (type === 'link') {
      parts.push(
        `<p><a href="${escapeHtml(block.linkUrl ?? '')}">${escapeHtml(block.linkTitle || block.linkUrl || '')}</a></p>`
      );
    } else if (type === 'code') {
      parts.push(
        `<pre style="background:#F3F4F6;border-radius:8px;padding:10px;overflow-x:auto;">` +
          `<code style="font-family:monospace;font-size:12px;white-space:pre;">${escapeHtml(block.text)}</code></pre>`
      );
    } else if (type === 'heading') {
      const level = block.headingLevel === 1 ? 1 : block.headingLevel === 3 ? 3 : 2;
      parts.push(`<h${level} style="margin:14px 0 6px;">${textToHtml(block.text)}</h${level}>`);
    } else if (type === 'sketch') {
      // Vectors, not a picture of them - see sketchToSvg. This used to be
      // the words "[Малюнок]", which is what a note full of drawings came
      // out of an export looking like.
      const svg = sketchToSvg(block.sketchElements, {
        width: block.sketchWidth,
        height: block.sketchHeight,
      });
      parts.push(svg || '<p>[Малюнок]</p>');
    } else if (type === 'dbRow') {
      // Only the snapshot title - an export is a flat file, so there's
      // nothing live to render here.
      parts.push(`<p>[Запис: ${escapeHtml(block.dbRowTitle || 'Без назви')}]</p>`);
    } else if (type === 'dbView') {
      parts.push(`<p>[Вигляд: ${escapeHtml(block.dbViewTitle || 'Вигляд')}]</p>`);
    } else if (type === 'table') {
      const rows = block.tableRows ?? [];
      const rowsHtml = rows
        .map(
          (row, r) =>
            `<tr>${row.cells
              .map(
                (_, c) =>
                  `<td style="border:1px solid #ccc;padding:4px 8px;">${escapeHtml(displayValueOf(rows, r, c))}</td>`
              )
              .join('')}</tr>`
        )
        .join('');
      parts.push(`<table style="border-collapse:collapse;margin:8px 0;">${rowsHtml}</table>`);
    } else if (block.text.trim()) {
      parts.push(`<p style="margin:4px 0;">${textToHtml(block.text)}</p>`);
    }
  }
  return `<html><body style="font-family:-apple-system,sans-serif;padding:24px;">
    <h1>${escapeHtml(title || 'Без назви')}</h1>
    ${parts.join('\n')}
  </body></html>`;
}

// Plain-text equivalent for the .txt export - a table's columns become
// tab-separated so pasting into a spreadsheet still lines up.
export function buildDocumentText(title: string, blocks: Block[]): string {
  const lines: string[] = [title || 'Без назви', ''];
  for (const block of blocks) {
    const type = block.type ?? 'paragraph';
    const plain = plainTextOf(block.text);
    if (type === 'divider') {
      lines.push('---');
    } else if (type === 'checkbox') {
      lines.push(`${block.checked ? '[x]' : '[ ]'} ${plain}`);
    } else if (type === 'bulleted') {
      lines.push(`- ${plain}`);
    } else if (type === 'numbered') {
      lines.push(`1. ${plain}`);
    } else if (type === 'file') {
      lines.push(`[Файл: ${block.fileTitle || block.fileName || ''}]`);
    } else if (type === 'link') {
      lines.push(`${block.linkTitle || ''} ${block.linkUrl || ''}`.trim());
    } else if (type === 'sketch') {
      lines.push('[Малюнок]');
    } else if (type === 'dbRow') {
      lines.push(`[Запис: ${block.dbRowTitle || 'Без назви'}]`);
    } else if (type === 'dbView') {
      lines.push(`[Вигляд: ${block.dbViewTitle || 'Вигляд'}]`);
    } else if (type === 'table') {
      const rows = block.tableRows ?? [];
      rows.forEach((row, r) => lines.push(row.cells.map((_, c) => displayValueOf(rows, r, c)).join('\t')));
    } else {
      lines.push(plain);
    }
  }
  return lines.join('\n');
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[/\\]/g, '-').trim() || 'Без назви';
}
