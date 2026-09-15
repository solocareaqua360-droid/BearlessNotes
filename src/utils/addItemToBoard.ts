import {
  collection,
  doc,
  getDoc,
  setDoc,
} from '../firestore';
import { addDoc } from './owned';
import { db } from '../firebase';
import { keyedAll, readBoardPart } from './boardStorage';
import { BoardCard, BoardColumn } from '../types';
import { cardFor, ImportableItem } from './importGroupToBoard';
import { labelForKind } from './groups';
import {
  APPROX_CARD_HEIGHT,
  COLUMN_CARD_GAP,
  COLUMN_HEADER_HEIGHT,
  COLUMN_PADDING,
  COLUMN_SPACING,
  COLUMN_WIDTH,
  WORLD_CENTER,
} from './boardLayout';

// The single-item counterpart to importGroupToBoard.ts's group import: one
// file/photo/link/text landing on a board reuses whichever column already
// collects that kind (see BoardColumn.kind), so repeatedly sending items to
// the same board builds up one running column per type instead of a fresh
// one every time. A group import never reuses a column for exactly the
// opposite reason - each import is its own batch, titled with the group's
// own name.
export async function addItemToBoard(boardId: string, item: ImportableItem): Promise<void> {
  const card = cardFor(item);
  if (!card) return;

  const snapshot = await getDoc(doc(db, 'boards', boardId));
  const data = snapshot.data();
  const existingCards = readBoardPart<BoardCard>(data?.cards);
  const existingColumns = readBoardPart<BoardColumn>(data?.columns);
  // A board still holding arrays has to be written whole once, because
  // merging a keyed patch into an array replaces it. After that, and for
  // every board already keyed, only the new card is written - which is
  // the point: this used to read the array, append, and put the whole
  // thing back, so anything another device had added in between was
  // overwritten by what this one happened to have read.
  const legacy = Array.isArray(data?.cards) || Array.isArray(data?.columns);

  // A file/photo/link/document card reuses its record's own id (see the
  // blockFrom* helpers cardFor calls) - already on this board is a
  // no-op, not a duplicate.
  if (existingCards.some((c) => c.id === card.id)) return;

  const column = existingColumns.find((c) => c.kind === item.kind);
  if (column) {
    const cardsInColumn = existingCards.filter((c) => c.columnId === column.id);
    const placed: BoardCard = {
      ...card,
      columnId: column.id,
      x: column.x + COLUMN_PADDING,
      y: column.y + COLUMN_HEADER_HEIGHT + cardsInColumn.length * (APPROX_CARD_HEIGHT + COLUMN_CARD_GAP),
    };
    await setDoc(
      doc(db, 'boards', boardId),
      {
        cards: legacy ? keyedAll([...existingCards, placed]) : { [placed.id]: placed },
        ...(legacy ? { columns: keyedAll(existingColumns) } : {}),
        updatedAt: Date.now(),
      },
      { merge: true }
    );
    return;
  }

  const columnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const x =
    existingColumns.length === 0
      ? WORLD_CENTER - COLUMN_WIDTH / 2
      : Math.max(...existingColumns.map((c) => c.x)) + COLUMN_WIDTH + COLUMN_SPACING;
  const y = existingColumns.length === 0 ? WORLD_CENTER : existingColumns[0].y;
  const newColumn: BoardColumn = { id: columnId, title: labelForKind(item.kind, {}), x, y, kind: item.kind };

  const placed: BoardCard = { ...card, columnId, x: x + COLUMN_PADDING, y: y + COLUMN_HEADER_HEIGHT };
  await setDoc(
    doc(db, 'boards', boardId),
    {
      cards: legacy ? keyedAll([...existingCards, placed]) : { [placed.id]: placed },
      columns: legacy ? keyedAll([...existingColumns, newColumn]) : { [newColumn.id]: newColumn },
      updatedAt: Date.now(),
    },
    { merge: true }
  );
}

// "Нова дошка" from the save-destination sheet - same shape
// createBoardForGroup already gives a fresh board, plus adding the one
// item right away.
export async function createBoardAndAddItem(name: string, item: ImportableItem): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, 'boards'), {
    title: name || 'Без назви',
    cards: {},
    columns: {},
    createdAt: now,
    updatedAt: now,
  });
  await addItemToBoard(ref.id, item);
  return ref.id;
}
