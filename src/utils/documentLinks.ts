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
// Text links (a selection turned into a link) will add their own source
// here when they exist; this is deliberately the one place that knows
// what counts as a link.
export function documentLinksIn(blocks: Block[] | undefined): string[] {
  const ids = new Set<string>();
  for (const block of blocks ?? []) {
    if ((block.type ?? 'paragraph') === 'docRef' && block.docRefId) ids.add(block.docRefId);
  }
  return Array.from(ids);
}
