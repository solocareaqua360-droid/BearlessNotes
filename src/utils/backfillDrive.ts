import * as LegacyFileSystem from 'expo-file-system/legacy';
import { doc, getDocs, setDoc, updateDoc } from '../firestore';
import { db } from '../firebase';
import { ownedQuery } from './owned';
import { keyedAll, readBoardPart } from './boardStorage';
import { BoardCard, BoardColumn } from '../types';
import { backupFileToDrive } from './googleDrive';

// The photos and files that were saved before there was a Drive backup at
// all - they exist as records everywhere, but their BYTES are only on the
// device that made them, so on a second device they are a card with
// nothing behind it.
//
// Boards are walked too, and that is not the same job. A photo dropped
// STRAIGHT onto a board never becomes a `photos` record at all: it lives
// as a card inside the board document, holding a local path and nothing
// else. Walking only the two collections missed every one of them - five
// of the eight board images on this account - so the browser had nowhere
// to read them from, however well the board itself synced.
//
// Note COVERS are walked too, and they are the worst case of the three.
// A cover never had a copy of its own at all: it looked for a block in
// its own note whose picture was the same file and read that block's -
// so every cover chosen from the gallery, the camera or the stock search
// has nothing anywhere, however old the note is.
//
// This walks them and uploads whatever this device still has locally. It
// can only be run where the bytes are; anywhere else every one of them is
// counted as "gone" and left alone, never deleted.
export type BackfillResult = { uploaded: number; missing: number; failed: number };

function mimeOf(name: string, fallback: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'pdf') return 'application/pdf';
  return fallback;
}

async function existsLocally(uri?: string): Promise<boolean> {
  if (!uri || !uri.startsWith('file://')) return false;
  try {
    const info = await LegacyFileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
}

export async function backfillDriveCopies(
  onProgress?: (done: number, total: number) => void
): Promise<BackfillResult> {
  const result: BackfillResult = { uploaded: 0, missing: 0, failed: 0 };

  const [photos, files, boards, documents] = await Promise.all([
    getDocs(ownedQuery('photos')),
    getDocs(ownedQuery('files')),
    getDocs(ownedQuery('boards')),
    getDocs(ownedQuery('documents')),
  ]);

  // Where the resulting driveFileId has to be written back. A collection
  // record takes it as a field of its own; a board card takes it inside
  // the board's `cards` map, under that card's id - which is why the two
  // cannot share one write.
  //
  // And that per-card merge is only safe once `cards` IS a map. Merging a
  // map into a FIELD THAT HOLDS AN ARRAY does not merge - Firestore
  // replaces the array outright, and every other card on that board is
  // gone. This is not hypothetical: it destroyed four cards on a board
  // called «mindEva» the first time this code ran. So any board still
  // holding arrays is converted, whole, BEFORE a single upload starts -
  // the same one-off migration addItemToBoard does for the same reason.
  type Target =
    | { kind: 'record'; collectionName: 'photos' | 'files'; id: string }
    | { kind: 'card'; boardId: string; cardId: string }
    | { kind: 'cover'; documentId: string };

  const jobs: {
    target: Target;
    uri?: string;
    name: string;
    mimeType: string;
    folder: 'Photos' | 'Files';
  }[] = [];

  photos.docs.forEach((snapshot) => {
    const data = snapshot.data();
    if (data.driveFileId) return;
    jobs.push({
      target: { kind: 'record', collectionName: 'photos', id: snapshot.id },
      uri: data.imageUri as string | undefined,
      name: `${snapshot.id}.jpg`,
      mimeType: 'image/jpeg',
      folder: 'Photos',
    });
  });
  files.docs.forEach((snapshot) => {
    const data = snapshot.data();
    if (data.driveFileId) return;
    const name = (data.fileName as string | undefined) ?? `${snapshot.id}`;
    jobs.push({
      target: { kind: 'record', collectionName: 'files', id: snapshot.id },
      uri: data.fileUri as string | undefined,
      name,
      mimeType: mimeOf(name, (data.mimeType as string | undefined) ?? 'application/octet-stream'),
      folder: 'Files',
    });
  });
  // A note's cover, which until now had no copy of ANY kind unless it
  // happened to be a picture also sitting in the note as a block - see
  // types.ts. Every cover chosen from the gallery, the camera or the
  // stock search is therefore here, however old the note is.
  //
  // Skipped when a block in that same note already has a copy of the same
  // file: the cover reads that one (see extractPreview), so uploading a
  // second would be a duplicate nobody asked for.
  documents.docs.forEach((snapshot) => {
    const data = snapshot.data();
    const cover = data.coverImageUri as string | undefined;
    if (!cover || data.coverDriveFileId) return;
    const blocks = (data.blocks as { imageUri?: string; driveFileId?: string }[] | undefined) ?? [];
    if (blocks.some((b) => b.imageUri === cover && b.driveFileId)) return;
    jobs.push({
      target: { kind: 'cover', documentId: snapshot.id },
      uri: cover,
      name: `cover-${snapshot.id}.jpg`,
      mimeType: 'image/jpeg',
      folder: 'Photos',
    });
  });

  // Boards that still hold arrays and have at least one card to upload.
  const toConvert: string[] = [];
  boards.docs.forEach((snapshot) => {
    const data = snapshot.data();
    const cards = readBoardPart<BoardCard>(data?.cards);
    const before = jobs.length;
    cards.forEach((card) => {
      if (card.driveFileId) return;
      if (card.imageUri) {
        jobs.push({
          target: { kind: 'card', boardId: snapshot.id, cardId: card.id },
          uri: card.imageUri,
          name: `${card.id}.jpg`,
          mimeType: 'image/jpeg',
          folder: 'Photos',
        });
        return;
      }
      if (card.fileUri) {
        const name = card.fileName ?? card.id;
        jobs.push({
          target: { kind: 'card', boardId: snapshot.id, cardId: card.id },
          uri: card.fileUri,
          name,
          mimeType: mimeOf(name, card.mimeType ?? 'application/octet-stream'),
          folder: 'Files',
        });
      }
    });
    if (jobs.length > before && (Array.isArray(data?.cards) || Array.isArray(data?.columns))) {
      toConvert.push(snapshot.id);
    }
  });

  // The migration, before any upload. Written whole and once per board -
  // after this every `cards` is a map, and the per-card merges below
  // cannot replace anything.
  for (const boardId of toConvert) {
    const data = boards.docs.find((d) => d.id === boardId)?.data();
    await setDoc(
      doc(db, 'boards', boardId),
      {
        cards: keyedAll(readBoardPart<BoardCard>(data?.cards)),
        columns: keyedAll(readBoardPart<BoardColumn>(data?.columns)),
      },
      { merge: true }
    );
  }

  let done = 0;
  for (const job of jobs) {
    done += 1;
    onProgress?.(done, jobs.length);
    if (!(await existsLocally(job.uri))) {
      result.missing += 1;
      continue;
    }
    try {
      const uploaded = await backupFileToDrive(job.uri as string, job.name, job.mimeType, job.folder);
      if (!uploaded) {
        result.failed += 1;
        continue;
      }
      if (job.target.kind === 'record') {
        await updateDoc(doc(db, job.target.collectionName, job.target.id), {
          driveFileId: uploaded.fileId,
          driveBytes: uploaded.bytes,
        });
      } else if (job.target.kind === 'cover') {
        // Two fields on the note itself, not a block - a cover is the
        // note's own, and nothing else reads them.
        await updateDoc(doc(db, 'documents', job.target.documentId), {
          coverDriveFileId: uploaded.fileId,
          coverDriveBytes: uploaded.bytes,
        });
      } else {
        // One card, merged - not the whole `cards` map. The board is very
        // likely open on the other device while this runs, and writing the
        // map whole would throw away whatever it moved in the meantime.
        await setDoc(
          doc(db, 'boards', job.target.boardId),
          {
            cards: {
              [job.target.cardId]: { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes },
            },
          },
          { merge: true }
        );
      }
      result.uploaded += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
