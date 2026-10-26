import type { Block } from '../types';

// Which other documents a note points at.
//
// Derived from the note's own blocks rather than maintained by hand: a
// card can be added, moved, copied or deleted by a dozen different paths
// in the editor, and any one of them forgetting to keep a list in step
// is a link that silently stops existing. Reading it back out of the
// blocks cannot get out of step, because the blocks ARE the note.
//
// It is stored all the same (Document.linksTo), and only so the question
// can be asked in the other direction. "What does this note point at" is
// answerable from the note; "which notes point HERE" is not - it is a
// question about every other note, and this is the field that answers it
// without reading them all.
//
// This is deliberately the one place that knows what counts as a link: a
// card of a note ('docRef'), and a word in the text that links to one
// ({n:<id>}label{/n} - see documentBlocks' NOTE_LINK_OPEN).
// A note only - a board or a file link carries a `b:` / `f:` prefix and is not matched here.
const WORD_LINK = /\{n:([A-Za-z0-9_-]+)(?:#[A-Za-z0-9_-]+)?\}/g;

export function documentLinksIn(blocks: Block[] | undefined): string[] {
  const ids = new Set<string>();
  for (const block of blocks ?? []) {
    if ((block.type ?? 'paragraph') === 'docRef' && block.docRefId) ids.add(block.docRefId);
    for (const m of (block.text ?? '').matchAll(WORD_LINK)) ids.add(m[1]);
  }
  return Array.from(ids);
}

// Whether a block points at a note - as a card or by a word in it.
export function blockLinksTo(block: Block, documentId: string): boolean {
  if ((block.type ?? 'paragraph') === 'docRef') return block.docRefId === documentId;
  const text = block.text ?? '';
  return text.includes(`{n:${documentId}}`) || text.includes(`{n:${documentId}#`);
}
