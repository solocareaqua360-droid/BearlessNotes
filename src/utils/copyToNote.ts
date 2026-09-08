import { addDoc, arrayUnion, collection, doc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Block } from '../types';

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
}): Block {
  const block: Block = { id: photo.id, text: '', type: 'image', imageUri: photo.imageUri };
  if (photo.imageFit) block.imageFit = photo.imageFit;
  if (photo.title) block.imageTitle = photo.title;
  if (photo.createdAt) block.createdAt = photo.createdAt;
  // See blockFromFile's identical comment on why this prevents a duplicate
  // Drive upload when referencing an already-backed-up photo.
  if (photo.driveFileId) block.driveFileId = photo.driveFileId;
  if (photo.driveBytes) block.driveBytes = photo.driveBytes;
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
