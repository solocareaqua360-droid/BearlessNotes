import { collection, deleteField, doc, getDoc, updateDoc } from '../firestore';
import { db } from '../firebase';
import { addDoc, setDoc } from './owned';
import { documentLinksIn } from './documentLinks';
import type { Block } from '../types';

// TECHNICAL NOTES (the user's, 2026-10-02): notes that belong to a record -
// an app's «Розбір» and its other notes, later a video lesson's note - and
// live there, not in the documents list ("не хочеться потім сортувати в
// нотатках мої технічні опси"). An ordinary document with an `owner`: the
// same editor, sync, search and backup; the documents list leaves it out.
// What is put in one (a picture, a link, a file) is technical with it -
// see useTechnicalDocs and the databases' "вкладення записів".

// A NESTED NOTE (2026-10-05) is owned the same way, by another note: kept
// out of the documents list, shown at the foot of its parent («Вкладені»),
// binned with it. Unlike a record's notes it is an ordinary note in every
// other respect - what is put in it is not technical (useTechnicalDocs).
export type DocOwner =
  | { kind: 'row'; id: string; databaseId: string }
  | { kind: 'link'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'chat'; id: string }
  // A board's map (utils/boardMap).
  | { kind: 'board'; id: string }
  // A thought theme's own board (utils/themeBoard).
  | { kind: 'theme'; id: string };

// The record's main note («Розбір») has an id of its own, the way a day's
// note does (day_<date>): found without a query, never made twice.
export const mainNoteId = (rowId: string) => `rec_${rowId}`;

export async function ensureMainNote(owner: DocOwner, title: string): Promise<string> {
  const id = mainNoteId(owner.id);
  const ref = doc(db, 'documents', id);
  const snap = await getDoc(ref);
  if (!(snap as { exists: () => boolean }).exists()) {
    const now = Date.now();
    await setDoc(ref, { title, blocks: [], owner, ownerMain: true, createdAt: now, updatedAt: now }, { merge: true });
  }
  return id;
}

// `blocks`: what it holds from the start (the chosen blocks of «У вкладену нотатку»).
export async function createOwnedNote(owner: DocOwner, title: string, blocks: Block[] = []): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, 'documents'), { title, blocks, linksTo: documentLinksIn(blocks), owner, createdAt: now, updatedAt: now });
  return ref.id;
}

// The same, with its id known AT ONCE (the write goes on in the background): a word that links to it can stand in the line in
// the same keystroke that made it («@» over chosen words, 2026-10-23) - an addDoc waits for the server before it says the id.
export function startOwnedNote(owner: DocOwner, title: string): string {
  const ref = doc(collection(db, 'documents'));
  const now = Date.now();
  setDoc(ref, { title, blocks: [], linksTo: [], owner, createdAt: now, updatedAt: now }).catch(() => {});
  return ref.id;
}

// «Зробити звичайною»: into the documents list, with what it holds.
export async function makeOrdinary(docId: string): Promise<void> {
  await updateDoc(doc(db, 'documents', docId), { owner: deleteField(), ownerMain: deleteField() });
}

// THE RULE for a picture, a link or a file (the user's question, answered
// yes): technical when no ordinary note uses it, and something technical
// does - a record holds it, or a technical note does.
export function isTechnicalItem(
  id: string,
  documentIds: string[],
  recordIds: Set<string>,
  technicalDocIds: Set<string>
): boolean {
  if (documentIds.some((d) => !technicalDocIds.has(d))) return false;
  return recordIds.has(id) || documentIds.length > 0;
}
