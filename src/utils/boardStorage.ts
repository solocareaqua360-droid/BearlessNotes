import { deleteField } from '../firestore';
import { contentEqual } from './contentEqual';

// How a board is stored, and why it changed shape.
//
// It used to hold its cards as an ARRAY, and every save wrote that array
// whole. That is one document with one value, so the unit of conflict was
// THE WHOLE BOARD: a phone that had been offline reconnected and wrote
// the cards it remembered, and anything the laptop had done meanwhile was
// not merged or flagged - it simply stopped existing. Adding a card had
// the same shape of bug, since it read the array, appended, and put the
// whole thing back.
//
// Keyed by id instead, a card is a field of its own. Firestore merges a
// write field by field, so two devices touching DIFFERENT cards never
// collide at all, and the same card is decided per card rather than per
// board. A deletion is the field being removed; land it last and the
// edits before it go with the card, which is what anyone would expect.
//
// The offline part needs no code here: Firestore already keeps unsent
// writes on disk, survives a restart, and replays them in the order they
// were made. What it could not do was stop them carrying the whole board
// with them.

export type WithId = { id: string };

// Boards written before this change hold arrays; both shapes read the
// same way, so nothing has to be converted before it can be opened.
export function readBoardPart<T extends WithId>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object') {
    return Object.values(raw as Record<string, T>).filter((item) => !!item && !!item.id);
  }
  return [];
}

export function keyedAll<T extends WithId>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  items.forEach((item) => {
    out[item.id] = item;
  });
  return out;
}

// Only what moved: the card that changed, and the id of the one that
// went. Null when nothing did, so an unchanged part is not written at
// all - an empty patch would still bump the document and wake every
// other device for nothing.
export function keyedDiff<T extends WithId>(before: T[], after: T[]): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const afterIds = new Set(after.map((item) => item.id));

  after.forEach((item) => {
    const previous = beforeById.get(item.id);
    if (!previous || !contentEqual(previous, item)) patch[item.id] = item;
  });
  before.forEach((item) => {
    if (!afterIds.has(item.id)) patch[item.id] = deleteField();
  });

  return Object.keys(patch).length > 0 ? patch : null;
}
