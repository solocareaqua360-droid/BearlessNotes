import { deleteDoc, doc, getDoc, getDocs, updateDoc } from '../firestore';
import { ownedQuery } from './owned';
import { readBoardPart } from './boardStorage';
import { db } from '../firebase';
import type { BoardCard, BoardItem } from '../types';
import { linkDocId } from './linkId';
import { binNote } from './nestedNotes';

// WHAT A DELETED OBJECT TAKES WITH IT, AND WHAT IT LEAVES (the user,
// 2026-10-09: "не продукувати сміття і бардак"). A board is mostly
// REFERENCES - a photo, a link, a note lying on it is a record of its own
// in a base - so deleting the board used to leave all of those behind,
// unasked and unseen. Now the window «Що лишити?» (DeleteContentsSheet)
// asks, grouped by kind, and this file does the two jobs under it:
//   describeBoard - what lies on the board that lives in a base too;
//   removeItems   - sends the chosen ones to their own bin (nothing here
//                   deletes for good except a board nested on a board,
//                   which has no bin - and says so in its row).
// What is on the board ONLY (stickies, free text, shapes, a picture
// that has no record) dies with it, and is only counted, never asked.

export type PlanKind = 'photo' | 'file' | 'link' | 'note' | 'board';

export type PlanItem = {
  // collection/id - one key for the checkbox state and the drag.
  key: string;
  kind: PlanKind;
  collection: string;
  id: string;
  title: string;
  // Also lying on another board (or inside a note) - deleting it here
  // would empty a place that is not being deleted.
  shared: boolean;
  // A photo's own picture, so fourteen «Без назви» can be told apart.
  thumb?: { uri: string; driveFileId?: string };
  // What the thing IS when its title does not say (a site, a file name, the
  // first line of a note, how many cards a board holds) - the row has to
  // show what is being deleted, not only that something is.
  subtitle?: string;
  // The tile's own icon when there is no picture.
  icon: string;
};

export type PlanGroup = { kind: PlanKind; label: string; items: PlanItem[] };

export type BoardPlan = {
  groups: PlanGroup[];
  // Things only the board holds - they go with it, silently.
  ownCount: number;
};

export const KIND_LABEL: Record<PlanKind, string> = {
  photo: 'Фото',
  file: 'Файли',
  link: 'Посилання',
  note: 'Нотатки',
  board: 'Дошки',
};

const ORDER: PlanKind[] = ['note', 'board', 'photo', 'file', 'link'];

type Ref = { kind: PlanKind; collection: string; id: string; title: string; thumb?: PlanItem['thumb']; subtitle?: string; icon: string };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function firstLine(text?: string): string | undefined {
  const line = (text || '').split('\n').map((l) => l.trim()).find((l) => l && !/^\[[^\]]*\]$/.test(l));
  if (!line) return undefined;
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}

function refOf(card: BoardCard): Ref | null {
  const type = card.type as string | undefined;
  if (type === 'image') {
    return {
      kind: 'photo',
      collection: 'photos',
      id: card.recordId || card.id,
      title: card.imageTitle || 'Без назви',
      thumb: card.imageUri ? { uri: card.imageUri, driveFileId: card.driveFileId } : undefined,
      icon: 'image-outline',
    };
  }
  if (type === 'file') {
    const isPicture = !!card.mimeType?.startsWith('image/') && !!card.fileUri;
    return {
      kind: 'file',
      collection: 'files',
      id: card.recordId || card.id,
      title: card.fileTitle || card.fileName || 'Файл',
      subtitle: card.fileName && card.fileName !== card.fileTitle ? card.fileName : card.mimeType,
      thumb: isPicture ? { uri: card.fileUri!, driveFileId: card.driveFileId } : undefined,
      icon: 'document-outline',
    };
  }
  if (type === 'link' && card.linkUrl) {
    return {
      kind: 'link',
      collection: 'links',
      id: linkDocId(card.linkUrl),
      title: card.linkTitle || card.linkUrl,
      subtitle: card.linkSiteName || hostOf(card.linkUrl),
      thumb: card.linkImageUrl ? { uri: card.linkImageUrl } : undefined,
      icon: 'link-outline',
    };
  }
  if (type === 'document' && card.documentId) {
    return {
      kind: 'note',
      collection: 'documents',
      id: card.documentId,
      title: card.documentTitle || 'Без назви',
      subtitle: firstLine(card.documentPreviewText),
      thumb: card.documentPreviewImageUri
        ? { uri: card.documentPreviewImageUri, driveFileId: card.documentPreviewDriveFileId }
        : undefined,
      icon: 'document-text-outline',
    };
  }
  if (type === 'board' && card.boardId) {
    return { kind: 'board', collection: 'boards', id: card.boardId, title: card.boardTitle || 'Без назви', icon: 'easel-outline' };
  }
  return null;
}

// The same reference on any OTHER board that stays.
function sharedKeys(others: BoardItem[]): Set<string> {
  const keys = new Set<string>();
  others.forEach((b) =>
    (b.cards || []).forEach((c) => {
      const r = refOf(c);
      if (r) keys.add(`${r.collection}/${r.id}`);
    })
  );
  return keys;
}

function boardSubtitle(id: string, boards: BoardItem[]): string | undefined {
  const n = boards.find((b) => b.id === id)?.cards?.length;
  return n === undefined ? undefined : `${n} карток`;
}

async function resolveGroups(
  refs: Map<string, Ref>,
  ownCount: number,
  elsewhere: Set<string>,
  allBoards: BoardItem[],
  selfDocId?: string
): Promise<BoardPlan> {
  const entries = Array.from(refs.entries());
  const found = await Promise.all(
    entries.map(async ([key, ref]) => {
      try {
        const snap = await getDoc(doc(db, ref.collection, ref.id));
        if (!snap.exists()) return { key, ref, alive: false, shared: false, title: ref.title };
        const data = (snap.data() || {}) as Record<string, unknown>;
        if (data.deletedAt) return { key, ref, alive: false, shared: false, title: ref.title };
        const used = data.usedInDocuments as Record<string, boolean> | undefined;
        const inNotes = !!used && Object.entries(used).some(([docId, on]) => on && docId !== selfDocId);
        const title = (typeof data.title === 'string' && data.title) || ref.title;
        return { key, ref, alive: true, shared: inNotes || elsewhere.has(key), title };
      } catch {
        return { key, ref, alive: false, shared: false, title: ref.title };
      }
    })
  );
  const groups: PlanGroup[] = ORDER.map((kind) => ({
    kind,
    label: KIND_LABEL[kind],
    items: found
      .filter((f) => f.ref.kind === kind && f.alive)
      .map((f) => ({
        key: f.key,
        kind,
        collection: f.ref.collection,
        id: f.ref.id,
        title: f.title,
        shared: f.shared,
        thumb: f.ref.thumb,
        subtitle: f.ref.kind === 'board' ? boardSubtitle(f.ref.id, allBoards) : f.ref.subtitle,
        icon: f.ref.icon,
      })),
  })).filter((g) => g.items.length > 0);
  // A reference whose record is gone (or already in the bin) is its own.
  return { groups, ownCount: ownCount + found.filter((f) => !f.alive).length };
}

export async function describeBoards(selected: BoardItem[], allBoards: BoardItem[]): Promise<BoardPlan> {
  const going = new Set(selected.map((b) => b.id));
  const refs = new Map<string, Ref>();
  let ownCount = 0;
  selected.forEach((board) =>
    (board.cards || []).forEach((card) => {
      const r = refOf(card);
      // A card that points at a board that is going anyway is not a thing to ask about.
      if (!r || (r.kind === 'board' && going.has(r.id))) {
        ownCount += 1;
        return;
      }
      refs.set(`${r.collection}/${r.id}`, r);
    })
  );
  const elsewhere = sharedKeys(allBoards.filter((b) => !going.has(b.id)));
  return resolveGroups(refs, ownCount, elsewhere, allBoards);
}

export function describeBoard(board: BoardItem, allBoards: BoardItem[]): Promise<BoardPlan> {
  return describeBoards([board], allBoards);
}

// A NOTE'S plan: its photo, file and link blocks are records in the bases
// too (mirrors), and a block pointing at another note is that note. Read
// from the stored note, not the open editor, so one function serves the
// editor, the list and the drag onto the bin.
export async function describeNote(documentId: string): Promise<BoardPlan> {
  const snap = await getDoc(doc(db, 'documents', documentId));
  const blocks = ((snap.data() || {}) as { blocks?: BoardCard[] }).blocks || [];
  const refs = new Map<string, Ref>();
  let ownCount = 0;
  blocks.forEach((block) => {
    let r = refOf(block);
    if (!r && block.docRefId) {
      r = {
        kind: 'note',
        collection: 'documents',
        id: block.docRefId,
        title: block.docRefTitle || 'Без назви',
        icon: 'document-text-outline',
      };
    }
    if (!r || r.id === documentId) {
      if (block.text?.trim() || block.sketchElements?.length || block.type === 'table') ownCount += 1;
      return;
    }
    refs.set(`${r.collection}/${r.id}`, r);
  });
  const boards = await getDocs(ownedQuery('boards')).then(
    (res) =>
      res.docs.map((d) => ({
        id: d.id,
        title: (d.data().title as string) ?? '',
        cards: readBoardPart<BoardCard>(d.data().cards),
      })) as BoardItem[],
    () => [] as BoardItem[]
  );
  return resolveGroups(refs, ownCount, sharedKeys(boards), boards, documentId);
}

// Chosen items to where each kind goes when it is deleted. Photos, files
// and links get the bin stamp their own screens read; a note goes through
// binNote with whatever is nested in it; a board gets the same stamp.
export async function removeItems(items: PlanItem[]): Promise<void> {
  await Promise.all(
    items.map(async (item) => {
      try {
        if (item.kind === 'note') await binNote(item.id);
        else if (item.kind === 'board') {
          // A board has a bin now (deletedAt, ignored by every reader - utils/isGone): 30 days to take it back.
          await updateDoc(doc(db, 'boards', item.id), { deletedAt: Date.now() });
        } else await updateDoc(doc(db, item.collection, item.id), { deletedAt: Date.now() });
      } catch (e) {
        console.warn('removeItems', item.key, e);
      }
    })
  );
}
