import * as LegacyFileSystem from 'expo-file-system/legacy';
import { doc, getDocs, setDoc, updateDoc } from '../firestore';
import { db } from '../firebase';
import { ownedQuery } from './owned';
import { readBoardPart } from './boardStorage';
import { BoardCard } from '../types';
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

  const [photos, files, boards] = await Promise.all([
    getDocs(ownedQuery('photos')),
    getDocs(ownedQuery('files')),
    getDocs(ownedQuery('boards')),
  ]);

  // Where the resulting driveFileId has to be written back. A collection
  // record takes it as a field of its own; a board card takes it inside
  // the board's `cards` map, under that card's id - which is why the two
  // cannot share one write.
  type Target =
    | { kind: 'record'; collectionName: 'photos' | 'files'; id: string }
    | { kind: 'card'; boardId: string; cardId: string };

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
  boards.docs.forEach((snapshot) => {
    readBoardPart<BoardCard>(snapshot.data()?.cards).forEach((card) => {
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
  });

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
