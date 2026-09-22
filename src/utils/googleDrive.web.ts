// Drive from a browser.
//
// This used to answer "not connected" to everything, on the reasoning
// that the board only ever asked for a backup after attaching a file and
// a truthful no cost nothing. That stopped being true the moment the
// browser build became the whole app and then a Mac application: a
// picture added here was kept as a path this page invented, so it
// existed on this machine and nowhere else - and unlike the phone, there
// was no copy anywhere to put it back from.
//
// So the upload is real now. What differs from googleDrive.ts is only
// the two things a browser does differently:
//
//   - the token comes from Google Identity Services (driveToken.web),
//     not from the native sign-in module. It lasts an hour, and when
//     there is none this answers null exactly as it always did - the
//     "Підключити Диск" bar is what gets a new one.
//   - the bytes are read with `fetch` and sent as a Blob, so nothing is
//     ever turned into base64. The phone has to, because React Native's
//     fetch cannot build a binary body; a browser can, and a few
//     megabytes of base64 is worth not making.
//
// Everything else - the folder names, their storage keys, the subfolder
// split, the usage counter - is deliberately identical, so both devices
// find the same folders and count into the same total.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, increment } from '../firestore';
import { setDoc } from './owned';
import { db } from '../firebase';
import { getDriveToken } from './driveToken.web';

const driveStatsDoc = doc(db, 'settings', 'driveStats');

const FOLDER_NAME = 'Bearless Notes';
const FOLDER_ID_STORAGE_KEY = 'bearlessNotes.driveFolderId';

export type DriveSubFolder = 'Photos' | 'Files';

const SUBFOLDER_ID_STORAGE_KEY: Record<DriveSubFolder, string> = {
  Photos: 'bearlessNotes.driveFolderId.photos',
  Files: 'bearlessNotes.driveFolderId.files',
};

// Never interactive: a token client always opens a window, and a browser
// only allows one from a click - see driveToken.web. An upload is not a
// click, so this takes the token already held or gives up.
async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getDriveToken(false);
  if (!token) throw new Error('Google Диск не підключено в цій вкладці');
  return fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

async function describeFailedResponse(response: Response): Promise<string> {
  const json = await response.json().catch(() => null);
  const message = (json as { error?: { message?: string } } | null)?.error?.message;
  return `HTTP ${response.status}: ${message ?? 'без деталей від Google'}`;
}

// Find it or make it, and remember which it was. Same keys as the phone
// uses, so a device that has already made the folder is not asked again.
async function ensureFolder(storageKey: string, name: string, parentId?: string): Promise<string> {
  const cached = await AsyncStorage.getItem(storageKey);
  if (cached) return cached;

  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const query = encodeURIComponent(
    `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`
  );
  const listRes = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`);
  const listJson = await listRes.json();
  let folderId: string | undefined = listJson.files?.[0]?.id;

  if (!folderId) {
    const metadata: Record<string, unknown> = { name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) metadata.parents = [parentId];
    const createRes = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
    const createJson = await createRes.json();
    folderId = createJson.id;
    if (!folderId) throw new Error(await describeFailedResponse(createRes));
  }

  await AsyncStorage.setItem(storageKey, folderId);
  return folderId;
}

async function ensureSubFolder(subFolder: DriveSubFolder): Promise<string> {
  return ensureFolder(SUBFOLDER_ID_STORAGE_KEY[subFolder], subFolder, await ensureFolder(FOLDER_ID_STORAGE_KEY, FOLDER_NAME));
}

// The same approximate counter SettingsScreen reads, written by both
// devices into one document - so what it shows is what is on the Drive,
// not what this machine happens to have sent. Best-effort: a failed
// count must never fail an upload that already succeeded.
function adjustDriveStats(bytesDelta: number, fileCountDelta: number) {
  setDoc(
    driveStatsDoc,
    { totalBytesStored: increment(bytesDelta), fileCount: increment(fileCountDelta) },
    { merge: true }
  ).catch(() => {});
}

export interface DriveStorageQuota {
  usage: number;
  limit: number | null;
}

export function isDriveConnected(): boolean {
  return false;
}

export function getConnectedEmail(): string | null {
  return null;
}

export async function connectGoogleDrive(): Promise<string> {
  throw new Error('Google Диск у браузері ще не підключений');
}

export async function disconnectGoogleDrive(): Promise<void> {}

// Null still means "no copy was made", and every caller already handles
// it: a failed backup must never block attaching the file. What has
// changed is that it is no longer the only answer.
//
// `localUri` here is whatever this page holds - a blob: URL from a
// picker, a data: URL, or an ordinary http one. `fetch` reads all three;
// a file:// path cannot exist in a browser, and if one arrives (a
// document written by the phone) the fetch fails and this answers null,
// which is the truth: those bytes are on the phone.
export async function backupFileToDrive(
  localUri: string,
  fileName: string,
  mimeType: string,
  subFolder: DriveSubFolder
): Promise<{ fileId: string; bytes: number } | null> {
  try {
    const response = await fetch(localUri);
    if (!response.ok) return null;
    const blob = await response.blob();
    const folderId = await ensureSubFolder(subFolder);

    // Drive's multipart upload, built as real form data: the browser
    // writes the boundary itself, which is why Content-Type must NOT be
    // set here.
    const body = new FormData();
    body.append(
      'metadata',
      new Blob([JSON.stringify({ name: fileName, parents: [folderId] })], { type: 'application/json' })
    );
    body.append('file', new Blob([blob], { type: mimeType || blob.type || 'application/octet-stream' }));

    const upload = await driveFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      { method: 'POST', body }
    );
    const json = await upload.json().catch(() => null);
    const fileId = (json as { id?: string } | null)?.id;
    if (!fileId) {
      console.warn('[googleDrive.web] upload failed', fileName, await describeFailedResponse(upload));
      return null;
    }
    adjustDriveStats(blob.size, 1);
    return { fileId, bytes: blob.size };
  } catch (e) {
    console.warn('[googleDrive.web] backupFileToDrive failed', fileName, e);
    return null;
  }
}

export async function downloadFileFromDrive(): Promise<boolean> {
  return false;
}

export async function runDriveDiagnostics(): Promise<string> {
  return 'Google Диск у браузері ще не підключений';
}

export async function getDriveStorageQuota(): Promise<DriveStorageQuota | null> {
  return null;
}

// Returns the reason it did not happen, or null when it did - the same
// contract the phone's has, because the same callers read it.
export async function deleteFileFromDrive(driveFileId: string, bytes?: number): Promise<string | null> {
  try {
    const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
      method: 'DELETE',
    });
    if (response.ok) {
      if (bytes) adjustDriveStats(-bytes, -1);
      return null;
    }
    return await describeFailedResponse(response);
  } catch (e) {
    return (e as Error).message;
  }
}

// The file is wherever the browser put it; there is nothing to fetch back.
export async function ensureLocalFile(): Promise<boolean> {
  return true;
}

// On the phone this notices that the account which just signed in
// already carries the Drive scope, so Settings can stop offering to
// "connect" what is connected. Here the two are genuinely separate
// grants from two Cloud projects (see driveToken.web), and the Drive
// half lives in that module rather than this one - so there is nothing
// to adopt and no email to report.
//
// It exists because SettingsScreen calls it, and the file's own rule at
// the top says every export of the real module is kept: a missing one
// is not a quiet no-op, it takes the screen down on the symbol.
export async function adoptSignedInAccountForDrive(): Promise<string | null> {
  return null;
}
