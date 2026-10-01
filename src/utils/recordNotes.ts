import { collection, deleteField, doc, getDoc, updateDoc } from '../firestore';
import { db } from '../firebase';
import { addDoc, setDoc } from './owned';

// TECHNICAL NOTES (the user's, 2026-10-02): notes that belong to a record -
// an app's «Розбір» and its other notes, later a video lesson's note - and
// live there, not in the documents list ("не хочеться потім сортувати в
// нотатках мої технічні опси"). An ordinary document with an `owner`: the
// same editor, sync, search and backup; the documents list leaves it out.
// What is put in one (a picture, a link, a file) is technical with it -
// see useTechnicalDocs and the databases' "вкладення записів".

export type DocOwner = { kind: 'row'; id: string; databaseId: string } | { kind: 'link'; id: string };

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

export async function createOwnedNote(owner: DocOwner, title: string): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, 'documents'), { title, blocks: [], owner, createdAt: now, updatedAt: now });
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
