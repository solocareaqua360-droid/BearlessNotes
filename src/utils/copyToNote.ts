import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  updateDoc,
} from '../firestore';
import { addDoc, setDoc } from './owned';
import { db } from '../firebase';
import { Block, Recurrence, SketchElement } from '../types';
import { dateKey } from './dateLocale';
import { scheduleReminder, ReminderKind } from './reminders';

const documentsCollection = collection(db, 'documents');

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// A file/photo block IS its mirror record (see DocumentEditorScreen's
// syncPhotosForDocument/syncFilesForDocument comment: "these stay keyed by
// the block's own id... a future 'insert an existing photo/file into
// another document' feature adds a second [usedInDocuments] key" - this is
// that feature) - so copying one reuses the SAME block id rather than
// minting a new one, and the same mirror record ends up referenced from
// both documents instead of being duplicated.
export function blockFromFile(file: {
  id: string;
  fileUri: string;
  fileName: string;
  mimeType?: string;
  title?: string;
  createdAt?: number;
  driveFileId?: string;
  driveBytes?: number;
}): Block {
  const block: Block = { id: file.id, text: '', type: 'file', fileUri: file.fileUri, fileName: file.fileName };
  if (file.mimeType) block.mimeType = file.mimeType;
  if (file.title) block.fileTitle = file.title;
  if (file.createdAt) block.createdAt = file.createdAt;
  // Carrying the source record's own driveFileId/driveBytes over (rather
  // than leaving them unset) is what tells syncFilesForDocument this file
  // is already backed up - without it, referencing an existing file from a
  // second document would look like a brand-new attachment and trigger a
  // duplicate upload to Drive.
  if (file.driveFileId) block.driveFileId = file.driveFileId;
  if (file.driveBytes) block.driveBytes = file.driveBytes;
  return block;
}

export function blockFromPhoto(photo: {
  id: string;
  imageUri: string;
  imageFit?: 'contain' | 'cover';
  title?: string;
  createdAt?: number;
  driveFileId?: string;
  driveBytes?: number;
  sketchElements?: SketchElement[];
  sketchWidth?: number;
  sketchHeight?: number;
}): Block {
  const block: Block = { id: photo.id, text: '', type: 'image', imageUri: photo.imageUri };
  if (photo.imageFit) block.imageFit = photo.imageFit;
  if (photo.title) block.imageTitle = photo.title;
  if (photo.createdAt) block.createdAt = photo.createdAt;
  // See blockFromFile's identical comment on why this prevents a duplicate
  // Drive upload when referencing an already-backed-up photo.
  if (photo.driveFileId) block.driveFileId = photo.driveFileId;
  if (photo.driveBytes) block.driveBytes = photo.driveBytes;
  // A drawing already made on this photo (from the Photos database viewer)
  // travels with it into the note - same record, same drawing.
  if (photo.sketchElements?.length) {
    block.sketchElements = photo.sketchElements;
    block.sketchWidth = photo.sketchWidth;
    block.sketchHeight = photo.sketchHeight;
  }
  return block;
}

// A sticker's content type (text/photo/sketch) reuses the ordinary
// paragraph/image/sketch BlockType - it never needed a type of its own,
// since a sticker can't nest inside another sticker. Keyed by the
// sticker's own id, same as file/photo, so inserting the same sticker into
// a second document reuses the one record instead of duplicating it.
// `isSticker: true` is what lets syncStickersForDocument (and the block
// renderer's yellow background) tell this apart from an ordinary block of
// the same type.
export function blockFromSticker(sticker: {
  id: string;
  type: 'paragraph' | 'image' | 'sketch';
  text?: string;
  imageUri?: string;
  driveFileId?: string;
  driveBytes?: number;
  sketchElements?: SketchElement[];
  sketchWidth?: number;
  sketchHeight?: number;
  createdAt?: number;
}): Block {
  const block: Block = { id: sticker.id, text: sticker.text ?? '', type: sticker.type, isSticker: true };
  if (sticker.imageUri) block.imageUri = sticker.imageUri;
  if (sticker.driveFileId) block.driveFileId = sticker.driveFileId;
  if (sticker.driveBytes) block.driveBytes = sticker.driveBytes;
  if (sticker.sketchElements) block.sketchElements = sticker.sketchElements;
  if (sticker.sketchWidth) block.sketchWidth = sticker.sketchWidth;
  if (sticker.sketchHeight) block.sketchHeight = sticker.sketchHeight;
  if (sticker.createdAt) block.createdAt = sticker.createdAt;
  return block;
}

// Unlike file/photo, a link's mirror record is keyed by the URL itself
// (linkDocId), not by any one block's id - a fresh id is fine here, the
// mirror update below is what ties it back to the same record.
export function blockFromLink(link: { url: string; title?: string; imageUrl?: string; siteName?: string }): Block {
  const block: Block = { id: generateId(), text: link.url, type: 'link', linkUrl: link.url };
  if (link.title) block.linkTitle = link.title;
  if (link.imageUrl) block.linkImageUrl = link.imageUrl;
  if (link.siteName) block.linkSiteName = link.siteName;
  return block;
}

// Appends `blocks` to `targetDocumentId` (or starts a fresh document when
// null) and marks every named mirror record as now used in that document -
// the same `usedInDocuments` bookkeeping DocumentEditorScreen's own sync
// functions do when a block like this is typed in directly. Done up front
// here since the target document might not be opened again in the editor
// for a while otherwise, leaving the mirror looking unused where it isn't.
export async function copyObjectsToNote(
  targetDocumentId: string | null,
  blocks: Block[],
  mirrorUpdates: { collectionName: string; id: string }[]
): Promise<string> {
  let documentId = targetDocumentId;
  if (documentId) {
    await updateDoc(doc(db, 'documents', documentId), {
      blocks: arrayUnion(...blocks),
      updatedAt: Date.now(),
    });
  } else {
    const now = Date.now();
    const newDocRef = await addDoc(documentsCollection, {
      title: 'Без назви',
      blocks,
      createdAt: now,
      updatedAt: now,
    });
    documentId = newDocRef.id;
  }
  await Promise.all(
    mirrorUpdates.map(({ collectionName, id }) =>
      setDoc(doc(db, collectionName, id), { [`usedInDocuments.${documentId}`]: true }, { merge: true })
    )
  );
  return documentId;
}

// "Сьогодні" from SaveDestinationSheet - appends into today's own daily
// note, creating it (with the `calendarDate` field CalendarScreen looks
// for) if today doesn't have one yet. A plain updateDoc like
// copyObjectsToNote's "existing document" branch would reject outright on
// a day that has nothing written yet - setDoc+merge is what makes "create
// if missing, append if not" one call.
export async function appendBlocksToToday(
  blocks: Block[],
  mirrorUpdates: { collectionName: string; id: string }[]
): Promise<string> {
  const documentId = `day_${dateKey(new Date())}`;
  await setDoc(
    doc(db, 'documents', documentId),
    { blocks: arrayUnion(...blocks), calendarDate: dateKey(new Date()), updatedAt: Date.now() },
    { merge: true }
  );
  await Promise.all(
    mirrorUpdates.map(({ collectionName, id }) =>
      setDoc(doc(db, collectionName, id), { [`usedInDocuments.${documentId}`]: true }, { merge: true })
    )
  );
  return documentId;
}

// A row of a user-created database as a document block. Like
// blockFromFile/blockFromPhoto (and unlike blockFromLink), the block reuses
// the record's OWN id, so one row embedded in two documents stays one
// record listed in both - see CustomDatabaseRow.usedInDocuments. The title
// is only a fallback label: the card renders the row live.
// Another note, as a card. The id is a fresh one rather than the target
// document's: unlike a photo or a database row, the SAME note can
// reasonably be pointed at twice from one document, and a block keyed by
// its target could only ever appear once.
export function blockFromDocument(document: { id: string; title?: string }): Block {
  return {
    id: generateId(),
    text: '',
    type: 'docRef',
    docRefId: document.id,
    docRefTitle: document.title?.trim() || undefined,
    createdAt: Date.now(),
  };
}

export function blockFromCustomRow(row: { id: string; databaseId: string; title: string; createdAt?: number }): Block {
  const block: Block = { id: row.id, text: '', type: 'dbRow', dbRowDatabaseId: row.databaseId };
  if (row.title) block.dbRowTitle = row.title;
  if (row.createdAt) block.createdAt = row.createdAt;
  return block;
}

// The same convention one level up: a 'dbView' block reuses the SAVED
// VIEW's own id, so it too stays one record listed in every document that
// embeds it - see CustomDatabaseView.usedInDocuments.
export function blockFromCustomView(view: { id: string; databaseId: string; name: string; createdAt?: number }): Block {
  const block: Block = { id: view.id, text: '', type: 'dbView', dbViewDatabaseId: view.databaseId };
  if (view.name) block.dbViewTitle = view.name;
  if (view.createdAt) block.createdAt = view.createdAt;
  return block;
}

// A block that IS its own record - its id is the record's id, and two
// documents holding that id hold ONE record listed in both (see the
// blockFrom* helpers above and usedInDocuments). Everything else is
// plain content, and a COPY of it has to be a new block: a checkbox is
// mirrored into `tasks` under its block id with a single documentId, so
// two copies sharing an id would be one task that keeps changing which
// note it belongs to.
const RECORD_BACKED = new Set(['image', 'file', 'dbRow', 'dbView']);

// One selected block on its way into a clipping note. Moving keeps every
// id - the block is the same block, it has simply gone somewhere else.
export function clippedBlock(block: Block, moving: boolean): Block {
  if (moving || RECORD_BACKED.has(block.type ?? 'paragraph')) return { ...block };
  return { ...block, id: generateId() };
}

// The blocks chosen in one note, as a note of their own. Named by the
// caller, because the name is the source's own plus "(вирізки)" and only
// the editor knows what the source is called.
export async function clipBlocksToNote(title: string, blocks: Block[]): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(documentsCollection, {
    title,
    blocks,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

// A task made from outside a note - the tasks screen's own "+", and a
// message in the chat turned into something to do. It is a checkbox block
// in TODAY's daily note, which is what every task in this app already is:
// no second kind of record, so the eight writers that reach a task
// through its document need no second path. The mirror is written here
// too, so the task shows up in the list at once rather than waiting for
// the note to be opened. Carries the calendar's own `calendarDate` field,
// or the day would not count as filled.
export async function createTaskInToday(
  text: string,
  // Set when a real project tab (not "Всі"/"Вхідні") is open at creation
  // time - the user's own ask, so a task made while looking at one
  // project doesn't default to "Вхідні" and need a second step to land
  // back where it was made.
  groupId?: string
): Promise<{ taskId: string; documentId: string }> {
  const key = dateKey(new Date());
  const documentId = `day_${key}`;
  const documentRef = doc(db, 'documents', documentId);
  const data = (await getDoc(documentRef)).data();
  const now = Date.now();
  const block: Block = {
    id: generateId(),
    type: 'checkbox',
    text,
    checked: false,
    createdAt: now,
    ...(groupId ? { groupId } : {}),
  };
  const blocks: Block[] = [...((data?.blocks as Block[] | undefined) ?? []), block];
  await setDoc(
    documentRef,
    {
      blocks,
      updatedAt: now,
      calendarDate: key,
      ...(data ? {} : { title: '', createdAt: now }),
    },
    { merge: true }
  );
  await setDoc(doc(db, 'tasks', block.id), {
    text,
    checked: false,
    documentId,
    updatedAt: now,
    createdAt: now,
    ...(groupId ? { groupId } : {}),
  });
  return { taskId: block.id, documentId };
}

// A recurring task's NEXT occurrence (see Recurrence, nextRecurrenceDate)
// - the same shape createTaskInToday writes, generalised to an arbitrary
// date and carrying forward the project/list/rule that made it. Never
// subtasks/comment/attachments - those started attached to the
// occurrence that just finished, not to the series itself.
export async function createTaskOnDate(
  text: string,
  targetDateKey: string,
  carry: { groupId?: string; listId?: string; recurrence?: Recurrence; reminderTime?: string; reminderKind?: ReminderKind }
): Promise<{ taskId: string; documentId: string }> {
  const documentId = `day_${targetDateKey}`;
  const documentRef = doc(db, 'documents', documentId);
  const data = (await getDoc(documentRef)).data();
  const now = Date.now();
  const id = generateId();
  // Scheduled BEFORE the block/mirror are built, so the notification id
  // lands in both writes the first time - no second round trip to patch
  // it in afterwards.
  const notificationId = carry.reminderTime
    ? await scheduleReminder(text, targetDateKey, carry.reminderTime, carry.reminderKind ?? 'alarm')
    : undefined;
  const block: Block = {
    id,
    type: 'checkbox',
    text,
    checked: false,
    createdAt: now,
    reminderDate: targetDateKey,
    ...(carry.groupId ? { groupId: carry.groupId } : {}),
    ...(carry.listId ? { listId: carry.listId } : {}),
    ...(carry.recurrence ? { recurrence: carry.recurrence } : {}),
    ...(carry.reminderTime
      ? { reminderTime: carry.reminderTime, reminderKind: carry.reminderKind ?? 'alarm' }
      : {}),
    ...(notificationId ? { reminderNotificationId: notificationId } : {}),
  };
  const blocks: Block[] = [...((data?.blocks as Block[] | undefined) ?? []), block];
  await setDoc(
    documentRef,
    {
      blocks,
      updatedAt: now,
      calendarDate: targetDateKey,
      ...(data ? {} : { title: '', createdAt: now }),
    },
    { merge: true }
  );
  const taskDoc: Record<string, unknown> = {
    text,
    checked: false,
    documentId,
    updatedAt: now,
    createdAt: now,
    reminderDate: targetDateKey,
  };
  if (carry.groupId) taskDoc.groupId = carry.groupId;
  if (carry.listId) taskDoc.listId = carry.listId;
  if (carry.recurrence) taskDoc.recurrence = carry.recurrence;
  if (carry.reminderTime) {
    taskDoc.reminderTime = carry.reminderTime;
    taskDoc.reminderKind = carry.reminderKind ?? 'alarm';
  }
  if (notificationId) taskDoc.reminderNotificationId = notificationId;
  await setDoc(doc(db, 'tasks', id), taskDoc);
  return { taskId: id, documentId };
}
