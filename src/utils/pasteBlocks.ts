import { BlockType, TableRow } from '../types';

// What a pasted piece of text turns into.
//
// A paste used to land in one block, newlines and all: a page copied from
// anywhere came in as a single paragraph the length of the page, and
// every list in it lost its list. React Native hands a TextInput plain
// text and nothing else, so the structure has to be read back OUT of the
// text - which is exactly what the shapes below are for, and what a
// person writing a list in a plain-text field has always done anyway.

export type ParsedBlock = {
  type: BlockType;
  text: string;
  checked?: boolean;
  headingLevel?: number;
  // A list item's nesting in the pasted text: two spaces (or a tab) a step, as Markdown writes it (Block.indent).
  indent?: number;
  codeLanguage?: string;
  tableRows?: TableRow[];
};

// A fence: ``` on its own line, optionally naming the language.
const FENCE = /^\s*```\s*([A-Za-z0-9+#.-]*)\s*$/;
// "# ", "## ", "### " - a heading, and its level is how many hashes.
const HEADING = /^\s*(#{1,6})\s+(.*)$/;
// A line that is only a rule.
const DIVIDER = /^\s*([-*_])\1{2,}\s*$/;
// "- ", "* ", "• " - and the checkbox forms that start the same way.
// How far a list line stands in: two spaces or a tab a step, up to four.
function stepsOf(line: string): { indent?: number } {
  const lead = (line.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '  ').length;
  const steps = Math.min(4, Math.floor(lead / 2));
  return steps > 0 ? { indent: steps } : {};
}
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
// "[ ] ", "[x] ", and the same behind a bullet: "- [ ] ".
const CHECKBOX = /^\s*(?:[-*•]\s+)?\[([ xX])\]\s+(.*)$/;

// A row of a table copied out of a spreadsheet: cells separated by tabs.
// This is what Excel, Numbers and Google Sheets put on the clipboard.
const TSV_ROW = /\t/;
// A row of a markdown table: "| a | b |".
const MD_ROW = /^\s*\|.*\|\s*$/;
// The line of dashes under a markdown table's head, which is not data.
const MD_RULE = /^\s*\|[\s:|-]+\|\s*$/;

// The inline marks of markdown (what a chat answer copied out of Claude,
// ChatGPT or Notion carries) in this editor's own terms. `code` has no
// mark of its own here, so its backticks simply go - in a pasted table
// they stood around every second word ("documents", "title"...) and read
// as litter. **bold** and *italic* are already this editor's own marks (parseFormattedText), so they stay as they are
// (italic used to be rewritten to _italic_, which the editor does not read: the underscores showed). A <br> inside a table cell is the line break it stands for.
export function inlineMarkdown(text: string): string {
  return text
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n');
}

function mdCells(line: string): string[] {
  // An escaped pipe is a pipe IN the cell, not a wall between two.
  const PIPE = '\u0000';
  return line
    .trim()
    .replace(/\\\|/g, PIPE)
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => inlineMarkdown(cell.trim().split(PIPE).join('|')));
}

function tableAt(lines: string[], start: number): { rows: TableRow[]; end: number } | null {
  const first = lines[start];
  const markdown = MD_ROW.test(first);
  const cellsOf = (line: string) => (markdown ? mdCells(line) : line.split('\t'));
  if (!markdown && !TSV_ROW.test(first)) return null;
  const width = cellsOf(first).length;
  if (width < 2) return null;
  const rows: TableRow[] = [];
  let i = start;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (markdown && MD_RULE.test(line)) continue;
    const matches = markdown ? MD_ROW.test(line) : TSV_ROW.test(line);
    if (!matches) break;
    const cells = cellsOf(line);
    // A run stops where the shape changes: a table is a rectangle, and a
    // line of a different width is the next thing, not a ragged row.
    if (cells.length !== width) break;
    rows.push({ cells });
  }
  // One row is a line with a tab in it, not a table.
  if (rows.length < 2) return null;
  return { rows, end: i };
}

// A TABLE OUT OF PASTED TEXT, as plain rows of strings (the import of a table by pasting, 2026-10-30): the first markdown table
// or tab-separated run in the text, else null. What a chat answer copied with its «copy» button, or a range copied out of a spreadsheet, is.
export function parsedTableGrid(raw: string): string[][] | null {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const found = tableAt(lines, i);
    if (found) return found.rows.map((row) => row.cells.map((cell) => inlineMarkdown(cell).replace(/\*\*/g, '').trim()));
  }
  return null;
}

export function parsePastedText(raw: string): ParsedBlock[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const out: ParsedBlock[] = [];
  // The plain lines gathered so far. In this editor a single Enter is a
  // line break INSIDE a paragraph and a blank line starts a new one - so
  // a run of plain lines is one block, and the blank line ends it.
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    const text = inlineMarkdown(paragraph.join('\n').replace(/\s+$/, ''));
    if (text !== '') out.push({ type: 'paragraph', text });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // A fenced block first: everything until the closing fence is the
    // author's own text, including blank lines and anything that would
    // otherwise read as a list. An unclosed fence runs to the end, which
    // is what a half-copied block is.
    const fence = line.match(FENCE);
    if (fence) {
      flush();
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        if (FENCE.test(lines[j])) break;
        body.push(lines[j]);
      }
      out.push({ type: 'code', text: body.join('\n'), codeLanguage: fence[1] || undefined });
      i = j;
      continue;
    }
    const table = tableAt(lines, i);
    if (table) {
      flush();
      out.push({ type: 'table', text: '', tableRows: table.rows });
      i = table.end - 1;
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (DIVIDER.test(line)) {
      flush();
      out.push({ type: 'divider', text: '' });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      out.push({ type: 'heading', text: inlineMarkdown(heading[2]), headingLevel: heading[1].length });
      continue;
    }
    const checkbox = line.match(CHECKBOX);
    if (checkbox) {
      flush();
      out.push({ type: 'checkbox', text: inlineMarkdown(checkbox[2]), checked: checkbox[1].toLowerCase() === 'x', ...stepsOf(line) });
      continue;
    }
    const numbered = line.match(NUMBERED);
    if (numbered) {
      flush();
      out.push({ type: 'numbered', text: inlineMarkdown(numbered[1]), ...stepsOf(line) });
      continue;
    }
    const bullet = line.match(BULLET);
    if (bullet) {
      flush();
      out.push({ type: 'bulleted', text: inlineMarkdown(bullet[1]), ...stepsOf(line) });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  // THE TOP HEADING OF WHAT WAS PASTED IS THE NOTE'S «ЗАГОЛОВОК 2» (the user, 2026-10-22: headings from a chat answer must arrive
  // sensibly). A chat answer is written under its own title, so its sections start at "##" and its subsections are "###" - read by hash
  // count they landed one and two levels too deep (and a "####" was lost altogether). The shallowest level in the paste becomes the first
  // level, the rest keep their distance from it, and anything deeper than the editor's three levels stays at the third.
  const hashLevels = out.filter((b) => b.type === 'heading').map((b) => b.headingLevel ?? 1);
  if (hashLevels.length > 0) {
    const shift = Math.min(...hashLevels) - 1;
    out.forEach((b) => {
      if (b.type === 'heading') b.headingLevel = Math.min(3, Math.max(1, (b.headingLevel ?? 1) - shift));
    });
  }
  return out;
}

// What was actually inserted, by comparing the field before and after.
//
// Typing adds one character; a paste adds a piece. Only the piece is
// parsed - the text around it is the user's own and is left exactly as
// it was, so pasting into the middle of a sentence does not reshape the
// sentence.
export function insertedPiece(before: string, after: string): { head: string; piece: string; tail: string } | null {
  if (after.length - before.length < 2) return null;
  let start = 0;
  while (start < before.length && before[start] === after[start]) start += 1;
  let back = 0;
  while (
    back < before.length - start &&
    before[before.length - 1 - back] === after[after.length - 1 - back]
  ) {
    back += 1;
  }
  const piece = after.slice(start, after.length - back);
  if (piece.length < 2) return null;
  return { head: after.slice(0, start), piece, tail: after.slice(after.length - back) };
}

// Is this paste worth breaking up at all? A piece with no newline and no
// table in it is just text, and goes in as text.
export function worthSplitting(parsed: ParsedBlock[]): boolean {
  if (parsed.length > 1) return true;
  const only = parsed[0];
  return !!only && only.type !== 'paragraph';
}
