import { Block } from '../types';

const PREVIEW_LENGTH = 140;
const SNIPPET_RADIUS = 30;

export type TextMatch = { before: string; match: string; after: string };

// Strips this app's inline rich-text markup (see DocumentEditorScreen's own
// comment on the format) so previews/snippets show plain reading text
// instead of literal "**bold**"/"{c:#hex}...{/c}" tokens.
export function stripFormatting(text: string): string {
  return text
    .replace(/\{c:#[0-9A-Fa-f]{6}\}/g, '')
    .replace(/\{h:#[0-9A-Fa-f]{6}\}/g, '')
    .replace(/\{\/c\}/g, '')
    .replace(/\{\/h\}/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\*(.+?)\*/g, '$1');
}

export function formatUpdatedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString('uk-UA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// The document-card thumbnail is always the FIRST image block, regardless
// of where it sits among other blocks - documents with no image at all get
// a placeholder (a document icon on a plain box, same size) rather than no
// thumbnail, so every row in the list keeps the same shape.
export function extractPreview(blocks: Block[] | undefined): { imageUri: string | null; previewText: string } {
  const list = blocks ?? [];
  const imageBlock = list.find((b) => (b.type ?? 'paragraph') === 'image' && b.imageUri);
  const previewText = list
    .map((b) => stripFormatting(b.text ?? '').trim())
    .filter((t) => t.length > 0)
    .join(' ')
    .slice(0, PREVIEW_LENGTH);
  return { imageUri: imageBlock?.imageUri ?? null, previewText };
}

// A window of plain text around the first case-insensitive match of
// `query` in the title, for highlighting - null when the title doesn't
// contain it. The title itself is short enough that no truncation window
// is needed, unlike the body snippet below.
export function findTitleMatch(title: string, query: string): TextMatch | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const idx = title.toLowerCase().indexOf(needle);
  if (idx === -1) return null;
  return { before: title.slice(0, idx), match: title.slice(idx, idx + needle.length), after: title.slice(idx + needle.length) };
}

// Scans the document's blocks in order for the first case-insensitive
// match of `query` and returns a short window of plain text around it
// (ellipsis on whichever side got truncated) - the body-search equivalent
// of findTitleMatch, used when the title itself doesn't already match.
export function findBodyMatch(blocks: Block[] | undefined, query: string): TextMatch | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  for (const block of blocks ?? []) {
    const clean = stripFormatting(block.text ?? '');
    const idx = clean.toLowerCase().indexOf(needle);
    if (idx === -1) continue;
    const start = Math.max(0, idx - SNIPPET_RADIUS);
    const end = Math.min(clean.length, idx + needle.length + SNIPPET_RADIUS);
    return {
      before: (start > 0 ? '…' : '') + clean.slice(start, idx),
      match: clean.slice(idx, idx + needle.length),
      after: clean.slice(idx + needle.length, end) + (end < clean.length ? '…' : ''),
    };
  }
  return null;
}

export function documentMatchesQuery(title: string, blocks: Block[] | undefined, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  if (title.toLowerCase().includes(needle)) return true;
  return (blocks ?? []).some((b) => stripFormatting(b.text ?? '').toLowerCase().includes(needle));
}
