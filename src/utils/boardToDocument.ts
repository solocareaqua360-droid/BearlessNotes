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
// The document of ONE column. A board gathers several themes side by side -
// and a group import makes a column per kind, so a board can easily hold
// half a dozen - while a document is one line of thought: the column you
// were reading, not everything that happens to share the canvas with it.
//
// Which is why the document belongs to the column rather than to the
// board: each column keeps its own, and re-forming rewrites that one.
export async function generateDocumentFromColumn(
  board: BoardItem,
  columnId: string
): Promise<{ documentId: string; columns: BoardColumn[] }> {
  const columns = board.columns ?? [];
  const column = columns.find((c) => c.id === columnId);
  const cards = board.cards.filter((c) => c.columnId === columnId);
  const blocks = await buildBlocksFromBoard({ cards, columns: column ? [column] : [] });
  const now = Date.now();
  const title = column?.title?.trim() || board.title?.trim() || 'Дошка';

  if (column?.documentId) {
    const ref = doc(db, 'documents', column.documentId);
    const existing = await getDoc(ref);
    if (existing.data() !== undefined) {
      await updateDoc(ref, { blocks, updatedAt: now, boardId: board.id });
      return { documentId: column.documentId, columns };
    }
  }

  const created = await addDoc(collection(db, 'documents'), {
    title,
    blocks,
    createdAt: now,
    updatedAt: now,
    boardId: board.id,
  });
  const nextColumns = columns.map((c) => (c.id === columnId ? { ...c, documentId: created.id } : c));
  await updateDoc(doc(db, 'boards', board.id), { columns: nextColumns });
  return { documentId: created.id, columns: nextColumns };
}

// ---------------------------------------------------------------------------
// Comparing what the two sides hold
// ---------------------------------------------------------------------------

// A value as a string that depends on its CONTENT and nothing else: keys
// in a fixed order, and keys holding undefined dropped the way Firestore
// drops them. Plain JSON.stringify compares key order too, and a document
// read back from Firestore never has the order it was written in.
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

export function blocksEqual(a: Block[], b: Block[]): boolean {
  return stable(a) === stable(b);
}

// The same comparison for a board's own cards and columns, read back from
// Firestore against the ones in memory.
export function contentEqual(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}
