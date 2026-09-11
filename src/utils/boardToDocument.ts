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
            id: `i_${card.id}_${block.id}`,
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

// Compared field by field rather than by reference: both sides rebuild
// constantly, and writing only when something actually differs is what
// stops the two from writing each other in a loop. Ids are derived (see
// cardBlockId), so identical content really does compare equal.
export function blocksEqual(a: Block[], b: Block[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type DocumentToBoardResult = {
  cards: BoardCard[];
  columns: BoardColumn[];
  // The document's blocks with any newly created card stamped onto them -
  // written back so the next comparison finds the two sides in agreement
  // instead of making a second card for the same paragraph.
  blocks: Block[];
  removedCardIds: string[];
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

  for (const block of blocks) {
    if (block.sourceColumnId) {
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
      // Belongs to another document; this pass never touches it.
      nextBlocks.push(block);
      continue;
    }

    const existing = block.sourceCardId ? byId.get(block.sourceCardId) : undefined;
    let card: BoardCard;
    if (existing) {
      card = { ...existing, ...cardFieldsFromBlock(block) };
      if (JSON.stringify(card) !== JSON.stringify(existing)) changed = true;
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

  return { cards, columns, blocks: nextBlocks, removedCardIds, changed };
}
