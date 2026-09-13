import * as LegacyFileSystem from 'expo-file-system/legacy';
import { collection, doc, getDocs, updateDoc } from '../firestore';
import { db } from '../firebase';
import { backupFileToDrive } from './googleDrive';

// The photos and files that were saved before there was a Drive backup at
// all - they exist as records everywhere, but their BYTES are only on the
// device that made them, so on a second device they are a card with
// nothing behind it.
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

  const [photos, files] = await Promise.all([
    getDocs(collection(db, 'photos')),
    getDocs(collection(db, 'files')),
  ]);

  const jobs: {
    collectionName: 'photos' | 'files';
    id: string;
    uri?: string;
    name: string;
    mimeType: string;
    folder: 'Photos' | 'Files';
  }[] = [];

  photos.docs.forEach((snapshot) => {
    const data = snapshot.data();
    if (data.driveFileId) return;
    jobs.push({
      collectionName: 'photos',
      id: snapshot.id,
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
      collectionName: 'files',
      id: snapshot.id,
      uri: data.fileUri as string | undefined,
      name,
      mimeType: mimeOf(name, (data.mimeType as string | undefined) ?? 'application/octet-stream'),
      folder: 'Files',
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
      await updateDoc(doc(db, job.collectionName, job.id), {
        driveFileId: uploaded.fileId,
        driveBytes: uploaded.bytes,
      });
      result.uploaded += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
