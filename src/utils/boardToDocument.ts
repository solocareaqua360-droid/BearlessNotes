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

// A card is already a Block plus placement (see BoardCard's own comment) -
// becoming a block is dropping the placement, nothing more. New id: the
// same photo or file may sit on the board and in the document at once, and
// two blocks sharing an id would confuse every mirror that keys on it.
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
  return { ...(rest as Block), id: generateId(), type: (rest.type as BlockType) ?? 'paragraph' };
}

function headingBlock(text: string): Block {
  // There is no heading block type in this app - bold is the whole
  // vocabulary a paragraph has (see stripFormatting's own list), so a
  // column's title is a bold line, the way it would be typed by hand.
  return { id: generateId(), text: `**${text}**`, type: 'paragraph' };
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
    if (blocks.length > 0) blocks.push({ id: generateId(), text: '', type: 'divider' });
    if (section.title) blocks.push(headingBlock(section.title));
    for (const card of section.cards) {
      if (card.type === 'document' && card.documentId) {
        const snapshot = await getDoc(doc(db, 'documents', card.documentId));
        const data = snapshot.data() as { title?: string; blocks?: Block[] } | undefined;
        const title = (data?.title ?? card.documentTitle ?? '').trim();
        if (title) blocks.push(headingBlock(title));
        (data?.blocks ?? []).forEach((block) => blocks.push({ ...block, id: generateId() }));
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
