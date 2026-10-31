import { deleteField, doc, getDoc, getDocs, updateDoc } from '../firestore';
import { db } from '../firebase';
import { ownedQuery, setDoc } from './owned';
import { deleteFileFromDrive } from './googleDrive';
import type { Block } from '../types';

// THE PICTURES THAT LIVE ON A PAGE ONLY (2026-10-31, the one rule): not in the Photos base, so nothing there lists them - this is
// the list. Read from the notes and boards on demand (not kept listening: the explorer must not carry every note's blocks).
// Used by the cleanup window («Кандидати на очищення» › «Картинки на сторінках»), the user's: «з часом воно забʼє диск».
export const OLD_MONTHS = 6;
export type PageImage = {
  key: string;
  where: 'day' | 'note' | 'board';
  parentId: string;
  blockId: string;
  title: string;
  at: number;
  bytes?: number;
  uri: string;
  driveFileId?: string;
};

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
export const isOld = (img: PageImage, now = Date.now()) => now - img.at >= OLD_MONTHS * MONTH_MS;

function dayMillis(key: unknown): number | null {
  if (typeof key !== 'string') return null;
  const t = new Date(`${key}T12:00:00`).getTime();
  return Number.isFinite(t) ? t : null;
}

export async function scanPageImages(): Promise<PageImage[]> {
  const out: PageImage[] = [];
  const [docs, boards] = await Promise.all([getDocs(ownedQuery('documents')), getDocs(ownedQuery('boards'))]);
  docs.docs.forEach((d) => {
    const data = d.data() as { title?: string; blocks?: Block[]; calendarDate?: string; updatedAt?: number; deletedAt?: number };
    if (data.deletedAt) return;
    const isDay = d.id.startsWith('day_') || !!data.calendarDate;
    const dayAt = isDay ? dayMillis(data.calendarDate ?? d.id.slice(4)) : null;
    (data.blocks ?? []).forEach((b) => {
      if ((b.type ?? 'paragraph') !== 'image' || !b.pageOnly || !b.imageUri) return;
      out.push({
        key: `d:${d.id}:${b.id}`,
        where: isDay ? 'day' : 'note',
        parentId: d.id,
        blockId: b.id,
        title: isDay ? (data.calendarDate ?? d.id.slice(4)) : data.title?.trim() || 'Без назви',
        at: dayAt ?? b.createdAt ?? data.updatedAt ?? 0,
        bytes: b.driveBytes,
        uri: b.imageUri,
        driveFileId: b.driveFileId,
      });
    });
  });
  boards.docs.forEach((d) => {
    const data = d.data() as { title?: string; cards?: Record<string, Block>; updatedAt?: number; deletedAt?: number };
    if (data.deletedAt) return;
    Object.entries(data.cards ?? {}).forEach(([id, c]) => {
      if ((c.type ?? 'paragraph') !== 'image' || !c.pageOnly || !c.imageUri) return;
      out.push({
        key: `b:${d.id}:${id}`,
        where: 'board',
        parentId: d.id,
        blockId: id,
        title: data.title?.trim() || 'Дошка',
        at: c.createdAt ?? data.updatedAt ?? 0,
        bytes: c.driveBytes,
        uri: c.imageUri,
        driveFileId: c.driveFileId,
      });
    });
  });
  return out.sort((a, b) => a.at - b.at);
}

// What on the Drive is held by something else too (a copy of a note shares its pictures' Drive files; a record in the base may
// hold the same one): those are never deleted from the Drive.
async function driveHeldElsewhere(removed: PageImage[]): Promise<Set<string>> {
  const ids = new Set(removed.map((r) => r.driveFileId).filter((x): x is string => !!x));
  const held = new Set<string>();
  if (ids.size === 0) return held;
  const gone = new Set(removed.map((r) => r.key));
  const [docs, boards, photos] = await Promise.all([getDocs(ownedQuery('documents')), getDocs(ownedQuery('boards')), getDocs(ownedQuery('photos'))]);
  docs.docs.forEach((d) =>
    ((d.data() as { blocks?: Block[] }).blocks ?? []).forEach((b) => {
      if (b.driveFileId && ids.has(b.driveFileId) && !gone.has(`d:${d.id}:${b.id}`)) held.add(b.driveFileId);
    })
  );
  boards.docs.forEach((d) =>
    Object.entries((d.data() as { cards?: Record<string, Block> }).cards ?? {}).forEach(([id, c]) => {
      if (c.driveFileId && ids.has(c.driveFileId) && !gone.has(`b:${d.id}:${id}`)) held.add(c.driveFileId);
    })
  );
  photos.docs.forEach((d) => {
    const f = (d.data() as { driveFileId?: string }).driveFileId;
    if (f && ids.has(f)) held.add(f);
  });
  return held;
}

// Takes the pictures off their pages for good, and their Drive copies with them unless something else holds the copy.
// Returns how many Drive copies could NOT be deleted (the pictures are gone from the pages either way).
export async function deletePageImages(list: PageImage[]): Promise<{ removed: number; driveFailed: number }> {
  const held = await driveHeldElsewhere(list);
  const byDoc = new Map<string, Set<string>>();
  const byBoard = new Map<string, string[]>();
  list.forEach((i) => {
    if (i.where === 'board') byBoard.set(i.parentId, [...(byBoard.get(i.parentId) ?? []), i.blockId]);
    else byDoc.set(i.parentId, (byDoc.get(i.parentId) ?? new Set()).add(i.blockId));
  });
  for (const [id, ids] of byDoc) {
    // Read fresh: the page may have been edited since the list was made.
    const snap = await getDoc(doc(db, 'documents', id));
    const blocks = ((snap.data() as { blocks?: Block[] } | undefined)?.blocks ?? []).filter((b) => !(ids.has(b.id) && b.pageOnly));
    await updateDoc(doc(db, 'documents', id), { blocks, updatedAt: Date.now() });
  }
  for (const [id, cardIds] of byBoard) {
    const patch: Record<string, unknown> = {};
    cardIds.forEach((c) => {
      patch[`cards.${c}`] = deleteField();
    });
    await updateDoc(doc(db, 'boards', id), patch);
  }
  let driveFailed = 0;
  for (const i of list) {
    if (!i.driveFileId || held.has(i.driveFileId)) continue;
    const problem = await deleteFileFromDrive(i.driveFileId, i.bytes);
    if (problem) driveFailed += 1;
  }
  return { removed: list.length, driveFailed };
}

// «У БАЗУ ЗОБРАЖЕНЬ» from the list: the record is made, the page's mark comes off.
export async function putPageImageIntoBase(i: PageImage): Promise<void> {
  const now = Date.now();
  const data: Record<string, unknown> = { imageUri: i.uri, imageFit: 'contain', createdAt: i.at || now, updatedAt: now, usedInDocuments: i.where === 'board' ? {} : { [i.parentId]: true } };
  if (i.driveFileId) data.driveFileId = i.driveFileId;
  if (i.bytes) data.driveBytes = i.bytes;
  await setDoc(doc(db, 'photos', i.blockId), data, { merge: true });
  if (i.where === 'board') {
    await updateDoc(doc(db, 'boards', i.parentId), { [`cards.${i.blockId}.pageOnly`]: deleteField() });
    return;
  }
  const snap = await getDoc(doc(db, 'documents', i.parentId));
  const blocks = ((snap.data() as { blocks?: Block[] } | undefined)?.blocks ?? []).map((b) => {
    if (b.id !== i.blockId) return b;
    const { pageOnly: _mark, ...rest } = b;
    return rest as Block;
  });
  await updateDoc(doc(db, 'documents', i.parentId), { blocks });
}
