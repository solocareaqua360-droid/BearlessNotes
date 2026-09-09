import { Block } from '../types';

const PREVIEW_LENGTH = 140;
// What an image-less grid card asks extractPreview for instead - see its
// own maxTextLength comment.
export const EXPANDED_PREVIEW_LENGTH = 600;
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

export type PreviewChecklistItem = { text: string; checked: boolean };

const PREVIEW_CHECKLIST_LIMIT = 4;
const PREVIEW_IMAGE_LIMIT = 4;

// The document-card thumbnail is the document's own cover image
// (DocumentEditorScreen's "..." menu) when it has one, else the FIRST image
// block regardless of where it sits among other blocks - documents with no
// image at all get a placeholder (a document icon on a plain box, same
// size) rather than no thumbnail, so every row in the list keeps the same
// shape. The cover only ever affects this single thumbnail slot, never
// `imageUris` (the photo-strip preview below it) - that stays exactly what
// the body's own image blocks show, cover or not.
//
// checklistItems/imageUris are the "live content" preview (DocumentCard's
// grid/list views show actual checkbox rows or a photo strip instead of
// just previewText when a document has them) - capped short since a card
// only ever has room for a handful, not a full copy of the document.
//
// `maxTextLength` defaults to the usual short PREVIEW_LENGTH (Search,
// Diary, Board, and a grid card that turns out to HAVE an image all want
// that) - DocumentsScreen's own grid passes a much longer one for an
// image-less card, which reclaims the thumbnail's space for text instead.
// Harmless to request even when a card ends up showing an image after
// all: the extra characters just sit unused, since what's actually
// rendered is capped separately by numberOfLines, not by string length.
export function extractPreview(
  blocks: Block[] | undefined,
  coverImageUri?: string,
  maxTextLength: number = PREVIEW_LENGTH
): {
  imageUri: string | null;
  imageUris: string[];
  previewText: string;
  checklistItems: PreviewChecklistItem[];
} {
  const list = blocks ?? [];
  const imageBlocks = list.filter((b) => (b.type ?? 'paragraph') === 'image' && b.imageUri);
  const checklistItems = list
    .filter((b) => (b.type ?? 'paragraph') === 'checkbox' && b.text.trim() !== '')
    .slice(0, PREVIEW_CHECKLIST_LIMIT)
    .map((b) => ({ text: stripFormatting(b.text).trim(), checked: !!b.checked }));
  const previewText = list
    .map((b) => stripFormatting(b.text ?? '').trim())
    .filter((t) => t.length > 0)
    .join(' ')
    .slice(0, maxTextLength);
  return {
    imageUri: coverImageUri ?? imageBlocks[0]?.imageUri ?? null,
    imageUris: imageBlocks.slice(0, PREVIEW_IMAGE_LIMIT).map((b) => b.imageUri as string),
    previewText,
    checklistItems,
  };
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
    const clean = stripFormatting(block.text ?? '') || (block.imageTitle ?? block.fileTitle ?? block.fileName ?? block.linkTitle ?? '');
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

// Whether a document (in practice, a daily note - see CalendarScreen) has
// any real content, as opposed to just the single blank paragraph every
// document gets seeded with on first load. Used by the "only filled days"
// filter, which must not count a day merely opened and never typed in.
export function hasNoteContent(title: string, blocks: Block[] | undefined): boolean {
  if (title.trim() !== '') return true;
  return (blocks ?? []).some((b) => {
    if ((b.text ?? '').trim() !== '') return true;
    const type = b.type ?? 'paragraph';
    return type === 'image' || type === 'file' || type === 'link' || type === 'divider' || type === 'sketch';
  });
}

// A block's own name/title, if it has one - image/file/link blocks all
// carry theirs inline (imageTitle, fileTitle/fileName, linkTitle), so
// matching against these needs no lookup into the photos/files/links
// collections those blocks mirror into.
function blockOwnTitle(b: Block): string | undefined {
  return b.imageTitle ?? b.fileTitle ?? b.fileName ?? b.linkTitle;
}

export function documentMatchesQuery(title: string, blocks: Block[] | undefined, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  if (title.toLowerCase().includes(needle)) return true;
  return (blocks ?? []).some(
    (b) =>
      stripFormatting(b.text ?? '').toLowerCase().includes(needle) ||
      (blockOwnTitle(b) ?? '').toLowerCase().includes(needle)
  );
}
