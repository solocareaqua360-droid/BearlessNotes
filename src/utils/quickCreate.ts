import * as DocumentPicker from 'expo-document-picker';
import { arrayUnion, collection, deleteDoc, doc, updateDoc } from '../firestore';
import { db } from '../firebase';
import { addDoc, setDoc } from './owned';
import { buildBlock, generateId } from './documentBlocks';
import { parsePastedText } from './pasteBlocks';
import { blockFromFile, blockFromPhoto, createTaskInToday, createTaskOnDate } from './copyToNote';
import { WORLD_CENTER } from './boardLayout';
import { copyPickedFile } from './localCopy';
import { backupFileToDrive } from './googleDrive';
import { compressPickedImage, pickPhotosFromDevice, writePhotoRecord } from './photoLibrary';
import { fetchLinkPreview, hostnameOf } from './linkPreview';
import { saveLinkInPlace } from './createItem';
import { ITEMS_COLLECTION_BY_KIND } from '../hooks/useTags';
import type { Block, FlashcardImage, Tag } from '../types';

// WHAT THE QUICK-CREATE WINDOW MAKES FROM ITS ONE FIELD (2026-10-13, the user's Craft-like window): the text typed
// is the thing - a note takes its first line as the name and the rest as its paragraphs, a task is the whole text,
// a card is a term and what follows it, a link is the address. A photo or a file added in the window goes INTO
// whatever is being made; with no text at all it is simply itself - a photo or a file, filed in the chosen folder,
// else standing in its own base.

export type QuickKind = 'document' | 'task' | 'day' | 'append' | 'board' | 'card' | 'link';

type AttachTag = (tag: Tag, kind: string, itemId: string, collection: string) => Promise<void>;

export type Attachment =
  | { id: string; kind: 'photo'; uri: string; name: string; driveFileId?: string; driveBytes?: number }
  | { id: string; kind: 'file'; uri: string; name: string; mimeType?: string };

const linesOf = (text: string) => text.split('\n').map((l) => l.trimEnd());
const collectionOf = (a: Attachment) => (a.kind === 'photo' ? 'photos' : 'files');

// Paragraph blocks from lines (blank lines dropped - the editor's own blank block is not made by typing Enter twice).
export function paragraphsFrom(lines: string[]): Block[] {
  return lines.filter((l) => l.trim()).map((l) => buildBlock(generateId(), 'paragraph', l));
}

// THE TEXT OF A NOTE, read as the editor reads a paste (2026-10-30, the user's: a chat answer pasted into this window
// arrived as raw «| a | b |» lines, pasted into an open note it became a table): headings, lists, checkboxes, code and
// tables are made what they say. Plain text with none of that keeps the window's own way - a line a paragraph.
export function blocksFromText(text: string): Block[] {
  const parsed = parsePastedText(text);
  if (!parsed.some((p) => p.type !== 'paragraph')) return paragraphsFrom(linesOf(text));
  return parsed.map((piece) => {
    const block = buildBlock(generateId(), piece.type, piece.text);
    if (piece.checked) block.checked = true;
    if (piece.headingLevel) block.headingLevel = piece.headingLevel;
    if (piece.indent) block.indent = piece.indent;
    if (piece.codeLanguage) block.codeLanguage = piece.codeLanguage;
    if (piece.tableRows) block.tableRows = piece.tableRows;
    return block;
  });
}

export function blocksFromAttachments(list: Attachment[]): Block[] {
  return list.map((a) =>
    a.kind === 'photo'
      ? blockFromPhoto({ id: a.id, imageUri: a.uri, driveFileId: a.driveFileId, driveBytes: a.driveBytes })
      : blockFromFile({ id: a.id, fileUri: a.uri, fileName: a.name, mimeType: a.mimeType })
  );
}

// The records the attachments already are are marked as used in the note they went into (so the bases know).
async function markUsed(list: Attachment[], documentId: string) {
  await Promise.all(list.map((a) => setDoc(doc(db, collectionOf(a), a.id), { [`usedInDocuments.${documentId}`]: true }, { merge: true })));
}

// ---- picking (the record is written at once, like everywhere in the app; thrown away if the window is closed) ------

export async function pickPhotoAttachments(source: 'gallery' | 'camera'): Promise<Attachment[]> {
  const added = await pickPhotosFromDevice(source);
  return added.map((p) => ({ id: p.id, kind: 'photo' as const, uri: p.imageUri, name: 'Фото' }));
}

export async function pickFileAttachments(): Promise<Attachment[]> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false, multiple: true });
  if (result.canceled || result.assets.length === 0) return [];
  const now = Date.now();
  const made: Attachment[] = [];
  for (const asset of result.assets) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fileUri = await copyPickedFile(asset.uri, id, asset.name);
    const data: Record<string, unknown> = { fileUri, fileName: asset.name, updatedAt: now, createdAt: now, usedInDocuments: {} };
    if (asset.mimeType) data.mimeType = asset.mimeType;
    await setDoc(doc(db, 'files', id), data, { merge: true });
    backupFileToDrive(fileUri, asset.name, asset.mimeType ?? 'application/octet-stream', 'Files').then((uploaded) => {
      if (uploaded) updateDoc(doc(db, 'files', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
    });
    made.push({ id, kind: 'file', uri: fileUri, name: asset.name, mimeType: asset.mimeType });
  }
  return made;
}

// FILES THE BROWSER HANDS OVER (the laptop: a paste, a drop, the file dialog): a picture becomes a photo record, anything else a
// file record, each at once, as the pickers above write them.
export async function attachmentsFromFiles(files: File[]): Promise<Attachment[]> {
  const made: Attachment[] = [];
  const now = Date.now();
  for (const file of files) {
    const uri = URL.createObjectURL(file);
    if (file.type.startsWith('image/')) {
      let imageUri = uri;
      try {
        const bitmap = await createImageBitmap(file);
        imageUri = await compressPickedImage(uri, bitmap.width, bitmap.height);
      } catch {
        imageUri = uri;
      }
      const photo = await writePhotoRecord(imageUri);
      made.push({ id: photo.id, kind: 'photo', uri: imageUri, name: file.name || 'Фото' });
      continue;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const data: Record<string, unknown> = { fileUri: uri, fileName: file.name, updatedAt: now, createdAt: now, usedInDocuments: {} };
    if (file.type) data.mimeType = file.type;
    await setDoc(doc(db, 'files', id), data, { merge: true });
    backupFileToDrive(uri, file.name, file.type || 'application/octet-stream', 'Files').then((uploaded) => {
      if (uploaded) updateDoc(doc(db, 'files', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
    });
    made.push({ id, kind: 'file', uri, name: file.name, mimeType: file.type || undefined });
  }
  return made;
}

// The window closed without making anything: what was picked for it goes away again.
export async function discardAttachments(list: Attachment[]) {
  await Promise.all(list.map((a) => deleteDoc(doc(db, collectionOf(a), a.id)).catch(() => {})));
}

// ---- making ---------------------------------------------------------------------------------------------------------

// NO TEXT, only pictures/files: each is simply itself - filed in the folder, else left in its own base.
export async function quickFileAttachments(list: Attachment[], folder: Tag | null, attachTag: AttachTag) {
  if (!folder) return;
  for (const a of list) await attachTag(folder, a.kind, a.id, collectionOf(a));
}

// A NOTE: what was typed is the TEXT of the note (its paragraphs), then the attachments; the name is given when it
// opens (the user, 2026-10-13: «введений текст є текстом нотатки, а назву ти задаєш, коли вона відкриється»).
// Returns the new document's id.
export async function quickCreateDocument(text: string, folder: Tag | null, attachTag: AttachTag, attachments: Attachment[] = []): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, 'documents'), {
    title: 'Без назви',
    createdAt: now,
    updatedAt: now,
    blocks: [...blocksFromText(text), ...blocksFromAttachments(attachments)],
  });
  if (folder) await attachTag(folder, 'document', ref.id, ITEMS_COLLECTION_BY_KIND.document);
  await markUsed(attachments, ref.id);
  return ref.id;
}

// A BOARD: what was typed becomes a TEXT BLOCK on the clean board (the board's «вільний блок»: paper, a text of the
// note's own kind, not a coloured sticky), at its centre; the name is given when the board opens - the same as a
// note. Born as a keyed map, like every board.
export async function quickCreateBoard(text: string, folder: Tag | null, attachTag: AttachTag): Promise<string> {
  const now = Date.now();
  const cards: Record<string, unknown> = {};
  if (text.trim()) {
    const id = generateId();
    cards[id] = {
      id,
      text: text.trim(),
      type: 'paragraph',
      freeBlock: true,
      createdAt: now,
      x: WORLD_CENTER - 120,
      y: WORLD_CENTER - 30,
      width: 240,
    };
  }
  const ref = await addDoc(collection(db, 'boards'), { title: 'Без назви', cards, createdAt: now, updatedAt: now });
  if (folder) await attachTag(folder, 'board', ref.id, 'boards');
  return ref.id;
}

// A TASK: one checkbox in a day's note (what every task in the app is - see createTaskInToday). With a day (the
// calendar's window) it is SET for that day; without, it lands in «Вхідні». Pictures/files stay on the task itself.
export async function quickCreateTask(text: string, attachments: Attachment[] = [], dayKey?: string): Promise<{ taskId: string; documentId: string }> {
  if (dayKey && attachments.length === 0) return createTaskOnDate(text.trim(), dayKey, {});
  return createTaskInToday(text.trim(), undefined, attachments.length ? blocksFromAttachments(attachments) : undefined);
}

// LINES FOR A DAY (today's unless another is chosen): paragraphs (and the attachments) at the end of that day's note,
// made if the day has none yet - with the `calendarDate` the calendar looks for. Returns the note's id.
export async function quickAddToDay(text: string, attachments: Attachment[] = [], dayKey: string): Promise<string> {
  const documentId = `day_${dayKey}`;
  await setDoc(
    doc(db, 'documents', documentId),
    {
      blocks: arrayUnion(...blocksFromText(text), ...blocksFromAttachments(attachments)),
      calendarDate: dayKey,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
  await markUsed(attachments, documentId);
  return documentId;
}

// LINES FOR A NOTE that is already there.
export async function quickAppendToDocument(documentId: string, text: string, attachments: Attachment[] = []): Promise<void> {
  await updateDoc(doc(db, 'documents', documentId), {
    blocks: arrayUnion(...blocksFromText(text), ...blocksFromAttachments(attachments)),
    updatedAt: Date.now(),
  });
  await markUsed(attachments, documentId);
}

// A CARD: the first line is the term, the rest the explanation, the photos its pictures (a file cannot be one).
export async function quickCreateCard(text: string, folder: Tag | null, attachTag: AttachTag, attachments: Attachment[] = []): Promise<string> {
  const [first = '', ...rest] = linesOf(text.trim());
  const now = Date.now();
  const id = generateId();
  const images: FlashcardImage[] = attachments
    .filter((a): a is Extract<Attachment, { kind: 'photo' }> => a.kind === 'photo')
    .map((a) => ({ uri: a.uri, ...(a.driveFileId ? { driveFileId: a.driveFileId } : {}), ...(a.driveBytes ? { driveBytes: a.driveBytes } : {}) }));
  await setDoc(doc(db, 'flashcards', id), {
    term: first.trim(),
    explanation: rest.join('\n').trim(),
    short: false,
    images,
    tagIds: [],
    createdAt: now,
    updatedAt: now,
  });
  if (folder) await attachTag(folder, 'flashcard', id, 'flashcards');
  return id;
}

// A LINK: the text is the address; the kind (a page, a video, a map point) is read from it by the same rule the
// links base uses. Returns the id, or undefined with nothing made when the text is not an address.
export async function quickCreateLink(text: string, folder: Tag | null, attachTag: AttachTag): Promise<string | undefined> {
  const url = text.trim().split(/\s+/)[0] ?? '';
  if (!/^https?:\/\/\S+\.\S+/i.test(url) && !/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(url)) return undefined;
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const preview = await fetchLinkPreview(full);
  return saveLinkInPlace(full, preview, preview.title || hostnameOf(full), { folder, attachTag });
}
