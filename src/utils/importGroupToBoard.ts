import { addDoc, collection, doc, getDoc, updateDoc } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { BoardCard, BoardColumn, Group } from '../types';
import { blockFromCustomRow, blockFromFile, blockFromLink, blockFromPhoto } from './copyToNote';
import {
  APPROX_CARD_HEIGHT,
  COLUMN_CARD_GAP,
  COLUMN_HEADER_HEIGHT,
  COLUMN_PADDING,
  COLUMN_SPACING,
  COLUMN_WIDTH,
  DEFAULT_CARD_WIDTH,
  WORLD_CENTER,
} from './boardLayout';

// At most this many cards of one kind land in one column. Chosen so a
// column still fits on screen zoomed out (~25 cards is roughly a screen
// and a half at that scale) and so the document it later converts into is
// still something you read in one sitting - and because the board renders
// every card at once, with no virtualization.
export const MAX_CARDS_PER_COLUMN = 25;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// One item of a group, carrying the source record's own fields so a card
// can be built from it without re-reading the document it came from.
export type ImportableItem = {
  id: string;
  kind: string;
  title: string;
  databaseId?: string;
  data: Record<string, unknown>;
};

// The board card for one item. Position is filled in by the caller (the
// column stacks them); null for a kind that has nothing to show as a card.
// Exported so addItemToBoard.ts (a single item, rather than a whole
// group) can build the same card shapes without a second copy of this
// per-kind logic.
export function cardFor(item: ImportableItem): BoardCard | null {
  const base = { x: 0, y: 0, width: DEFAULT_CARD_WIDTH };
  if (item.kind === 'photo') {
    return {
      ...blockFromPhoto({
        id: item.id,
        imageUri: item.data.imageUri as string,
        imageFit: item.data.imageFit as 'contain' | 'cover' | undefined,
        title: item.data.title as string | undefined,
        createdAt: item.data.createdAt as number | undefined,
        driveFileId: item.data.driveFileId as string | undefined,
        driveBytes: item.data.driveBytes as number | undefined,
      }),
      ...base,
    };
  }
  if (item.kind === 'file') {
    return {
      ...blockFromFile({
        id: item.id,
        fileUri: item.data.fileUri as string,
        fileName: item.data.fileName as string,
        mimeType: item.data.mimeType as string | undefined,
        title: item.data.title as string | undefined,
        createdAt: item.data.createdAt as number | undefined,
        driveFileId: item.data.driveFileId as string | undefined,
        driveBytes: item.data.driveBytes as number | undefined,
      }),
      ...base,
    };
  }
  if (item.kind.startsWith('link-')) {
    return {
      ...blockFromLink({
        url: item.data.url as string,
        title: item.data.title as string | undefined,
        imageUrl: item.data.imageUrl as string | undefined,
        siteName: item.data.siteName as string | undefined,
      }),
      ...base,
    };
  }
  if (item.kind.startsWith('customRow:') && item.databaseId) {
    return {
      ...blockFromCustomRow({
        id: item.id,
        databaseId: item.databaseId,
        title: item.title,
        createdAt: item.data.createdAt as number | undefined,
      }),
      ...base,
    };
  }
  if (item.kind === 'text') {
    return { id: generateId(), text: (item.data.text as string) ?? '', type: 'paragraph', ...base };
  }
  if (item.kind === 'document') {
    // Same shape addDocumentCard builds, minus the preview snapshot - the
    // board refreshes document previews on open anyway, so there's no
    // reason to read every document here just to prime them.
    return {
      id: generateId(),
      text: '',
      type: 'document',
      documentId: item.id,
      documentTitle: item.title,
      createdAt: Date.now(),
      ...base,
    };
  }
  return null;
}

// Puts the chosen items of a group onto a board as one column per kind,
// each titled "<group> · <kind>". One column per kind rather than one big
// one: it keeps every column short enough to take in at a glance, and each
// converts into a document that's actually about something ("all the links
// on this theme") instead of a pile.
//
// Columns are placed to the right of whatever the board already has, and
// their cards are stacked with an approximate height - the board's own
// reflow corrects the positions as soon as it measures the real ones.
export async function importGroupToBoard(
  boardId: string,
  group: Group,
  items: ImportableItem[],
  labelForKind: (kind: string) => string
): Promise<number> {
  const snapshot = await getDoc(doc(db, 'boards', boardId));
  const data = snapshot.data();
  const existingCards: BoardCard[] = data?.cards ?? [];
  const existingColumns: BoardColumn[] = data?.columns ?? [];

  const byKind = new Map<string, ImportableItem[]>();
  items.forEach((item) => {
    const list = byKind.get(item.kind) ?? [];
    if (list.length >= MAX_CARDS_PER_COLUMN) return;
    list.push(item);
    byKind.set(item.kind, list);
  });

  let nextX =
    existingColumns.length === 0
      ? WORLD_CENTER - COLUMN_WIDTH / 2
      : Math.max(...existingColumns.map((c) => c.x)) + COLUMN_WIDTH + COLUMN_SPACING;
  const y = existingColumns.length === 0 ? WORLD_CENTER : existingColumns[0].y;

  const newColumns: BoardColumn[] = [];
  const newCards: BoardCard[] = [];
  byKind.forEach((kindItems, kind) => {
    const columnId = generateId();
    newColumns.push({ id: columnId, title: `${group.name} · ${labelForKind(kind)}`, x: nextX, y });
    kindItems.forEach((item, index) => {
      const card = cardFor(item);
      if (!card) return;
      newCards.push({
        ...card,
        columnId,
        x: nextX + COLUMN_PADDING,
        y: y + COLUMN_HEADER_HEIGHT + index * (APPROX_CARD_HEIGHT + COLUMN_CARD_GAP),
      });
    });
    nextX += COLUMN_WIDTH + COLUMN_SPACING;
  });

  // A file/photo/dbRow card reuses its record's own id (see the blockFrom*
  // helpers), so importing something the board already holds would put two
  // cards on one id - a real key collision, not a harmless duplicate.
  const existingIds = new Set(existingCards.map((c) => c.id));
  const cardsToAdd = newCards.filter((c) => !existingIds.has(c.id));

  await updateDoc(doc(db, 'boards', boardId), {
    cards: [...existingCards, ...cardsToAdd],
    columns: [...existingColumns, ...newColumns],
    updatedAt: Date.now(),
  });
  return cardsToAdd.length;
}

// A board to import into, created on the spot when the user picks "нова
// дошка" rather than an existing one.
export async function createBoardForGroup(name: string): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, 'boards'), {
    title: name,
    cards: [],
    columns: [],
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}
