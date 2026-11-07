import { doc, getDoc, getDocFromCache } from '../firestore';
import { db } from '../firebase';
import { setDoc } from './owned';
import { WORLD_CENTER } from './boardLayout';
import type { BoardCard } from '../types';

// THE DAY'S BOARD (2026-10-08, «Сьогодні» step 1): every day may have a board
// of its own beside its sheet (the day note, day_<date>). Its id comes from
// the date, as the day note's does, so two devices that make it at the same
// time - offline, say - make ONE board, not two: the second write merges
// into the first. It carries `calendarDate`, which keeps it out of the
// boards list, the save-to destinations and the counters (the same field
// that keeps a day note out of the documents). On it from the start: the
// day's sheet as a document card, «Аркуш дня» - one id per day too, so it
// can never be laid twice.
export const dayBoardId = (key: string) => `day_${key}`;
const sheetCardId = (key: string) => `sheet_${key}`;

// A read that may not come back while offline is given this long.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

async function existsAnywhere(path: string, id: string): Promise<boolean> {
  const ref = doc(db, path, id);
  try {
    const cached = await getDocFromCache(ref);
    if ((cached as { exists: () => boolean }).exists()) return true;
  } catch {
    // Not in the cache - ask the server below.
  }
  try {
    const fresh = await withTimeout(getDoc(ref), 1500);
    return !!fresh && (fresh as { exists: () => boolean }).exists();
  } catch {
    return false;
  }
}

// The board for the day, made if it is not there yet; resolves with its id
// once the board can be opened from the local cache. Writes are not
// awaited: a write's promise only settles when the SERVER has it, and the
// board must open offline too.
export async function ensureDayBoard(key: string, title: string): Promise<string> {
  const id = dayBoardId(key);
  // The sheet the card points at must be a real day note - with its
  // calendarDate - before anything writes into it from the board, or the
  // editor would make a plain document under that id that the calendar
  // never sees. A merge of the one field changes nothing in a day that
  // already has its note, and an empty note does not mark the day filled.
  setDoc(doc(db, 'documents', `day_${key}`), { calendarDate: key }, { merge: true }).catch(() => {});
  if (await existsAnywhere('boards', id)) return id;
  const now = Date.now();
  const sheet: BoardCard = {
    id: sheetCardId(key),
    text: '',
    type: 'document',
    documentId: `day_${key}`,
    documentTitle: 'Аркуш дня',
    x: WORLD_CENTER - 120,
    y: WORLD_CENTER - 80,
    width: 240,
    createdAt: now,
  };
  setDoc(
    doc(db, 'boards', id),
    // Keyed maps from the first write (cards: {}) - a board born with an
    // array is read back as "shape unknown" and saves nothing (see the
    // memory board_shape_doubt).
    { title, calendarDate: key, cards: { [sheet.id]: sheet }, columns: {}, createdAt: now, updatedAt: now },
    { merge: true }
  ).catch(() => {});
  // Wait until the local cache holds it, so the board screen reads it.
  for (let i = 0; i < 20; i++) {
    try {
      const cached = await getDocFromCache(doc(db, 'boards', id));
      if ((cached as { exists: () => boolean }).exists()) break;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return id;
}
