import { addDoc, collection, doc, getDoc, updateDoc } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { Block, BlockType, BoardCard, BoardColumn, BoardItem } from '../types';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// columnId is null for the cards that never landed in a column - the
// section is real, it just has no heading and no lane behind it.
export type BoardSection = { columnId: string | null; title: string | null; cards: BoardCard[] };

// The board read as a document would read it: columns left to right, the
// cards inside one top to bottom, and whatever never landed in a column
// last. A board is a graph, a document is a line - this is the one place
// that decides how the first becomes the second, so the preview and the
// generated document can never disagree about the order.
export function boardSections(board: { cards: BoardCard[]; columns?: BoardColumn[] }): BoardSection[] {
  const columns = [...(board.columns ?? [])].sort((a, b) => a.x - b.x || a.y - b.y);
  const sections: BoardSection[] = columns.map((column) => ({
    columnId: column.id,
    title: column.title?.trim() || 'Без назви',
    cards: board.cards.filter((c) => c.columnId === column.id).sort((a, b) => a.y - b.y),
  }));
  const loose = board.cards
    .filter((c) => !c.columnId || !columns.some((col) => col.id === c.columnId))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (loose.length > 0) sections.push({ columnId: null, title: null, cards: loose });
  return sections;
}

// Ids are DERIVED from what the block came from, never generated fresh.
// Two consequences, both load-bearing: a rebuild produces exactly the same
// ids as the last one, so the two sides can be compared for equality
// instead of being written on every pass; and an edited block can always
// be traced back to its card. The prefixes keep them clear of the ids
// those cards and blocks carry in their own collections.
function cardBlockId(cardId: string): string {
  return `c_${cardId}`;
}

// A block belonging to a document card's source document, seen through
// this board's document: addressed by the card it came through AND its own
// id over there, so the same document pinned to the board twice still has
// two distinguishable copies here.
function inlineBlockId(cardId: string, blockId: string): string {
  return `i_${cardId}_${blockId}`;
}

// A card is already a Block plus placement (see BoardCard's own comment) -
// becoming a block is dropping the placement, nothing more.
function blockFromCard(card: BoardCard): Block {
  const {
    x: _x,
    y: _y,
    width: _width,
    color: _color,
    columnId: _columnId,
    documentId: _documentId,
    documentTitle: _documentTitle,
    documentPreviewText: _previewText,
    documentPreviewImageUri: _previewImage,
    documentExpanded: _expanded,
    ...rest
  } = card;
  return {
    ...(rest as Block),
    id: cardBlockId(card.id),
    type: (rest.type as BlockType) ?? 'paragraph',
    sourceCardId: card.id,
  };
}

function headingBlock(text: string, columnId: string): Block {
  // There is no heading block type in this app - bold is the whole
  // vocabulary a paragraph has (see stripFormatting's own list), so a
  // column's title is a bold line, the way it would be typed by hand.
  return { id: `h_${columnId}`, text: `**${text}**`, type: 'paragraph', sourceColumnId: columnId };
}

// Every card as blocks, in reading order. A document card brings its whole
// content rather than a link: the point of this is one file that can be
// read start to finish without following anything.
export async function buildBlocksFromBoard(board: {
  cards: BoardCard[];
  columns?: BoardColumn[];
}): Promise<Block[]> {
  const blocks: Block[] = [];
  for (const section of boardSections(board)) {
    const sectionKey = section.columnId ?? 'loose';
    if (blocks.length > 0) {
      blocks.push({ id: `d_${sectionKey}`, text: '', type: 'divider', sourceColumnId: sectionKey });
    }
    if (section.title) blocks.push(headingBlock(section.title, sectionKey));
    for (const card of section.cards) {
      if (card.type === 'document' && card.documentId) {
        const snapshot = await getDoc(doc(db, 'documents', card.documentId));
        const data = snapshot.data() as { title?: string; blocks?: Block[] } | undefined;
        const title = (data?.title ?? card.documentTitle ?? '').trim();
        // The card's own heading keeps the CARD's identity: deleting that
        // line in the document is how you say "drop this document from
        // here", and it has to reach the card to do that.
        if (title) {
          blocks.push({ ...headingBlock(title, sectionKey), id: cardBlockId(card.id), sourceCardId: card.id });
        }
        (data?.blocks ?? []).forEach((block) =>
          blocks.push({
            ...block,
            id: inlineBlockId(card.id, block.id),
            // These belong to the document they were inlined from, not to
            // the board - an edit here has to travel there, so they carry
            // that address instead of a card's.
            sourceDocumentId: card.documentId,
            sourceBlockId: block.id,
          })
        );
        continue;
      }
      blocks.push(blockFromCard(card));
    }
  }
  return blocks;
}

// Builds (or rebuilds) the board's document and ties the two together in
// both directions: the document remembers which board it came from, the
// board which document came out of it. That pair is what lets either one
// open the other beside it.
export async function generateDocumentFromBoard(board: BoardItem): Promise<string> {
  const blocks = await buildBlocksFromBoard(board);
  const now = Date.now();

  if (board.documentId) {
    const ref = doc(db, 'documents', board.documentId);
    const existing = await getDoc(ref);
    if (existing.data() !== undefined) {
      await updateDoc(ref, { blocks, updatedAt: now, boardId: board.id });
      return board.documentId;
    }
  }

  const created = await addDoc(collection(db, 'documents'), {
    title: board.title?.trim() || 'Дошка',
    blocks,
    createdAt: now,
    updatedAt: now,
    boardId: board.id,
  });
  await updateDoc(doc(db, 'boards', board.id), { documentId: created.id });
  return created.id;
}

// ---------------------------------------------------------------------------
// The other direction: a document read back onto the board it came from.
// ---------------------------------------------------------------------------

// A value as a string that depends on its CONTENT and nothing else: keys
// in a fixed order, and keys holding undefined dropped the way Firestore
// drops them. Plain JSON.stringify was the first attempt and it was wrong
// in the worst way - a document read back from Firestore has its keys in
// a different order than the object that was written, so every comparison
// said "different", both sides wrote on every pass, and the two chased
// each other in a loop that showed up as the save dot flickering.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${k}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// Both sides rebuild constantly; writing only when something actually
// differs is what stops them from writing each other in a loop. Ids are
// derived (see cardBlockId), so identical content really does compare
// equal.
export function blocksEqual(a: Block[], b: Block[]): boolean {
  return stable(a) === stable(b);
}

// An edit that belongs to a document card's source document rather than to
// the board: the whole new block list for that document, as read back out
// of this one. The caller compares it with what that document currently
// holds - it's the one that has to read it anyway.
export type SourceDocumentEdit = {
  documentId: string;
  blocks: Block[];
};

export type DocumentToBoardResult = {
  cards: BoardCard[];
  columns: BoardColumn[];
  // The document's blocks with any newly created card stamped onto them -
  // written back so the next comparison finds the two sides in agreement
  // instead of making a second card for the same paragraph.
  blocks: Block[];
  removedCardIds: string[];
  // Blocks inlined from a document card belong to THAT document - editing
  // one of them, or writing a new paragraph among them, has to travel
  // there instead of making a card here.
  documentEdits: SourceDocumentEdit[];
  changed: boolean;
};

const LOOSE = 'loose';

// Blocks a generated document never owns: a column's heading and the rule
// above it describe the board's shape, and an inlined block belongs to the
// document it came from.
function isStructural(block: Block): boolean {
  return !!block.sourceColumnId || !!block.sourceDocumentId;
}

// Everything a card takes from its block. Placement and the card-only
// display fields are deliberately left alone - those are the board's own
// business and nothing in the document describes them.
function cardFieldsFromBlock(block: Block): Partial<BoardCard> {
  const fields: Partial<BoardCard> = { text: block.text ?? '' };
  if (block.type !== undefined) fields.type = block.type;
  if (block.checked !== undefined) fields.checked = block.checked;
  return fields;
}

export function applyDocumentToBoard(
  blocks: Block[],
  board: { cards: BoardCard[]; columns?: BoardColumn[] },
  // looseOrigin: where a card made from a block that sits under no heading
  // lands on the canvas - the document says nothing about coordinates, so
  // the caller supplies a sensible spot (the middle of the world).
  options: { defaultCardWidth: number; looseOrigin: { x: number; y: number } }
): DocumentToBoardResult {
  const columns = [...(board.columns ?? [])];
  const byId = new Map(board.cards.map((c) => [c.id, c]));
  const nextBlocks: Block[] = [];
  // Section key -> the cards that section's blocks name, in block order.
  const order = new Map<string, BoardCard[]>();
  const placed: BoardCard[] = [];
  let changed = false;

  // Which section the blocks being read belong to - set by the heading and
  // divider blocks they follow, exactly as the eye reads it.
  let sectionKey = LOOSE;
  // The document card whose content we're currently inside, if any. It
  // opens at the first block inlined from that document and closes at the
  // first block that isn't - and while it's open, a paragraph with no
  // source of its own belongs to THAT document rather than to the board,
  // because that's where it was written.
  let inline: { documentId: string; cardId: string; blocks: Block[] } | null = null;
  const documentEdits: SourceDocumentEdit[] = [];

  function closeInline() {
    if (!inline) return;
    documentEdits.push({ documentId: inline.documentId, blocks: inline.blocks });
    inline = null;
  }

  for (const block of blocks) {
    if (block.sourceColumnId) {
      closeInline();
      sectionKey = block.sourceColumnId;
      // A renamed heading renames its column - the heading IS the column's
      // title, so editing one has to be editing the other.
      const heading = (block.text ?? '').trim().replace(/^\*\*(.*)\*\*$/, '$1').trim();
      const columnIndex = columns.findIndex((c) => c.id === block.sourceColumnId);
      if (columnIndex >= 0 && heading && columns[columnIndex].title !== heading) {
        columns[columnIndex] = { ...columns[columnIndex], title: heading };
        changed = true;
      }
      nextBlocks.push(block);
      continue;
    }
    if (block.sourceDocumentId) {
      // Belongs to a document card's source document. Collected rather
      // than skipped: an edit here is an edit THERE, and it travels with
      // the rest of that document's blocks.
      if (!inline || inline.documentId !== block.sourceDocumentId) {
        closeInline();
        inline = { documentId: block.sourceDocumentId, cardId: '', blocks: [] };
      }
      const match = block.id.match(/^i_(.+?)_(.*)$/);
      if (match) inline.cardId = match[1];
      // Back into the shape that document stores it in: its own id, none
      // of the addressing this document wrapped around it.
      const { sourceDocumentId: _d, sourceBlockId: _b, ...plain } = block;
      inline.blocks.push({ ...(plain as Block), id: block.sourceBlockId ?? block.id });
      nextBlocks.push(block);
      continue;
    }

    // A paragraph written among a document card's own text belongs to that
    // document too - it was written there, between its lines, not on the
    // board. It gets an id over there and this document's copy is stamped
    // to point at it, exactly as a new card's block is.
    if (inline && !block.sourceCardId) {
      const newId = generateId();
      inline.blocks.push({ ...block, id: newId });
      nextBlocks.push({
        ...block,
        id: inlineBlockId(inline.cardId, newId),
        sourceDocumentId: inline.documentId,
        sourceBlockId: newId,
      });
      changed = true;
      continue;
    }
    closeInline();

    const existing = block.sourceCardId ? byId.get(block.sourceCardId) : undefined;
    let card: BoardCard;
    if (existing) {
      card = { ...existing, ...cardFieldsFromBlock(block) };
      if (stable(card) !== stable(existing)) changed = true;
      nextBlocks.push(block);
    } else {
      // No card behind it: a paragraph written straight into the document.
      // It becomes a card, and the block is stamped so the next pass
      // recognises the two as the same thing instead of making a second.
      const id = generateId();
      const count = order.get(sectionKey)?.length ?? 0;
      card = {
        ...(cardFieldsFromBlock(block) as BoardCard),
        id,
        text: block.text ?? '',
        x: options.looseOrigin.x,
        y: options.looseOrigin.y + count * 40,
        width: options.defaultCardWidth,
      };
      nextBlocks.push({ ...block, id: cardBlockId(id), sourceCardId: id });
      changed = true;
    }
    const list = order.get(sectionKey) ?? [];
    list.push(card);
    order.set(sectionKey, list);
    placed.push(card);
  }

  closeInline();

  // Positions are rewritten only where the order actually changed. A
  // column's cards carry the real coordinates reflowColumns gave them, and
  // replacing those with plain indices on every pass would make this write
  // the board forever - the two sides would never agree.
  const byIdNext = new Map(placed.map((c) => [c.id, c]));
  for (const [key, list] of order) {
    if (key === LOOSE) {
      // Out of every column: the key is dropped, not set to undefined,
      // which Firestore rejects outright. Coordinates are left alone -
      // nothing in a document describes where a loose card sits.
      list.forEach((card) => {
        if (!card.columnId) return;
        const { columnId: _columnId, ...rest } = card;
        byIdNext.set(card.id, rest as BoardCard);
        changed = true;
      });
      continue;
    }
    const current = board.cards.filter((c) => c.columnId === key).sort((a, b) => a.y - b.y).map((c) => c.id);
    const wanted = list.map((c) => c.id);
    if (current.length === wanted.length && current.every((id, i) => id === wanted[i])) continue;
    list.forEach((card, index) => {
      byIdNext.set(card.id, { ...card, columnId: key, y: index });
    });
    changed = true;
  }

  const cards = placed.map((c) => byIdNext.get(c.id) as BoardCard);
  // Cards no block mentions any more were deleted from the document side.
  const kept = new Set(cards.map((c) => c.id));
  const removedCardIds = board.cards.filter((c) => !kept.has(c.id)).map((c) => c.id);
  if (removedCardIds.length > 0) changed = true;

  // The same document pinned to the board twice arrives here as two
  // separate runs of blocks, and there is no honest way to turn two runs
  // into one block list for it - so neither is written. Rare, and losing
  // the edit is better than writing the wrong half over the right one.
  const seenDocuments = new Map<string, number>();
  documentEdits.forEach((edit) => seenDocuments.set(edit.documentId, (seenDocuments.get(edit.documentId) ?? 0) + 1));
  const uniqueEdits = documentEdits.filter((edit) => seenDocuments.get(edit.documentId) === 1);
  if (uniqueEdits.length > 0) changed = true;

  return { cards, columns, blocks: nextBlocks, removedCardIds, documentEdits: uniqueEdits, changed };
}
