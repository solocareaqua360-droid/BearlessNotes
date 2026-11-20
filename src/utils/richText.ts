// FORMATTING IN A CARD'S TEXT (2026-10-11, the user's: a prompt copied from a chat into a flashcard lost
// its numbering). The cause is on the clipboard: a chat copies a numbered list as RICH text (HTML,
// `<ol><li>`), and a text field takes only the plain part, which has no numbers. So a paste is read
// again as HTML and turned into Markdown-ish plain text (`1. `, `- `, `# `, `**bold**`), which is
// what the card then stores and DRAWS as a list (parseRichLines below).

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»' };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

export function htmlToMarkdown(html: string): string {
  // The clipboard's HTML often carries a fragment marker, a style block and a head.
  const body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '');
  let out = '';
  // One entry per open list: its next number, or null for a bullet list.
  const lists: (number | null)[] = [];
  const tag = /<(\/?)([a-z][a-z0-9]*)\b[^>]*>|([^<]+)/gi;
  let match: RegExpExecArray | null;
  const newline = (n = 1) => {
    out = out.replace(/[ \t]+$/, '');
    const have = (out.match(/\n*$/)?.[0] ?? '').length;
    if (out.length > 0 && have < n) out += '\n'.repeat(n - have);
  };
  while ((match = tag.exec(body))) {
    if (match[3] !== undefined) {
      out += decode(match[3].replace(/\s+/g, ' '));
      continue;
    }
    const closing = match[1] === '/';
    const name = match[2].toLowerCase();
    if (name === 'br') {
      out += '\n';
    } else if (name === 'ol' || name === 'ul') {
      if (closing) {
        lists.pop();
        newline(1);
      } else {
        newline(1);
        lists.push(name === 'ol' ? 1 : null);
      }
    } else if (name === 'li') {
      if (!closing) {
        newline(1);
        const depth = Math.max(0, lists.length - 1);
        const top = lists.length - 1;
        const n = lists[top];
        out += `${'  '.repeat(depth)}${n === null || n === undefined ? '- ' : `${n}. `}`;
        if (typeof n === 'number') lists[top] = n + 1;
      } else newline(1);
    } else if (/^h[1-6]$/.test(name)) {
      if (!closing) {
        newline(2);
        out += `${'#'.repeat(Math.min(3, Number(name[1])))} `;
      } else newline(1);
    } else if (name === 'p' || name === 'div' || name === 'pre' || name === 'blockquote' || name === 'tr') {
      newline(closing ? 1 : name === 'p' ? 2 : 1);
    } else if (name === 'strong' || name === 'b') {
      out += '**';
    }
  }
  return out
    .replace(/\*\*\s*\*\*/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Letters only, lower-cased: how a pasted plain text and its rich twin are told to be the same words.
export function lettersOf(text: string): string {
  return text.replace(/[^\p{L}]+/gu, '').toLowerCase();
}

export type RichLine =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'number'; n: string; indent: number; text: string }
  | { kind: 'bullet'; indent: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'blank' };

export function parseRichLines(text: string): RichLine[] {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line): RichLine => {
    if (!line.trim()) return { kind: 'blank' };
    const indent = Math.floor((line.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '  ').length / 2);
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*\S)\s*$/);
    if (h) return { kind: 'heading', level: Math.min(3, h[1].length), text: h[2] };
    const n = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (n) return { kind: 'number', n: n[1], indent, text: n[2] };
    const b = line.match(/^\s*[-*•]\s+(.*)$/);
    if (b) return { kind: 'bullet', indent, text: b[1] };
    return { kind: 'para', text: line.trim() };
  });
}

// Does this text hold anything the card would draw differently from plain lines?
export function hasRichStructure(text: string): boolean {
  return parseRichLines(text).some((l) => l.kind === 'heading' || l.kind === 'number' || l.kind === 'bullet');
}

// A line of text as a LIST CELL shows it: the marks that only matter in the card itself are not shown.
export function plainPreview(text: string): string {
  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1');
}
