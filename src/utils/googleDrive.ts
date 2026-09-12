import { GoogleSignin } from '@react-native-google-signin/google-signin';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { doc, increment, setDoc } from '@react-native-firebase/firestore';
import { db } from '../firebase';

const driveStatsDoc = doc(db, 'settings', 'driveStats');

// drive.file (not the full "drive" scope) - this app can only see/manage
// files it creates itself, never the rest of the user's Drive.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Bearless Notes';
const FOLDER_ID_STORAGE_KEY = 'bearlessNotes.driveFolderId';

// Backed-up files are split into subfolders under "Bearless Notes" by kind
// (Photos/Files) rather than left flat, per the user's own request.
export type DriveSubFolder = 'Photos' | 'Files';
const SUBFOLDER_ID_STORAGE_KEY: Record<DriveSubFolder, string> = {
  Photos: 'bearlessNotes.driveFolderId.photos',
  Files: 'bearlessNotes.driveFolderId.files',
};

let configured = false;
function ensureConfigured() {
  if (configured) return;
  GoogleSignin.configure({ scopes: [DRIVE_SCOPE] });
  configured = true;
}

export function isDriveConnected(): boolean {
  ensureConfigured();
  return GoogleSignin.hasPreviousSignIn();
}

export function getConnectedEmail(): string | null {
  ensureConfigured();
  return GoogleSignin.getCurrentUser()?.user.email ?? null;
}

function hasDriveScope(): boolean {
  return GoogleSignin.getCurrentUser()?.scopes?.includes(DRIVE_SCOPE) ?? false;
}

// `configure({ scopes })` alone does NOT get drive.file granted on Android -
// signing in only authenticates, and anything past the default email/profile
// scopes needs this separate consent screen. Skipping it is what produced a
// successful sign-in whose token Drive then rejected with
// "Request had insufficient authentication scopes" (HTTP 403).
async function requestDriveScope(): Promise<boolean> {
  const response = await GoogleSignin.addScopes({ scopes: [DRIVE_SCOPE] });
  if (!response || response.type !== 'success') return false;
  return response.data.scopes?.includes(DRIVE_SCOPE) ?? false;
}

// Throws on cancel/failure - the Settings screen shows that as "not
// connected" rather than treating it as a real error.
export async function connectGoogleDrive(): Promise<string> {
  ensureConfigured();
  await GoogleSignin.hasPlayServices();
  const response = await GoogleSignin.signIn();
  if (response.type !== 'success') throw new Error('cancelled');
  if (!response.data.scopes?.includes(DRIVE_SCOPE)) await requestDriveScope();
  return response.data.user.email;
}

export async function disconnectGoogleDrive(): Promise<void> {
  ensureConfigured();
  await GoogleSignin.signOut();
  await AsyncStorage.multiRemove([FOLDER_ID_STORAGE_KEY, ...Object.values(SUBFOLDER_ID_STORAGE_KEY)]);
}

async function getDriveAccessToken(): Promise<string> {
  ensureConfigured();
  await GoogleSignin.signInSilently();
  const { accessToken } = await GoogleSignin.getTokens();
  return accessToken;
}

// Every Drive call goes through here. Play Services caches access tokens,
// and one minted before the drive.file consent was granted stays cached and
// keeps coming back 401/403 long after the permission is in place - which is
// exactly what left uploads working (fresh token right after the consent
// screen) while a later delete still failed. clearCachedAccessToken forces
// the next call to mint a new one, so one retry settles it.
async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string) =>
    fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });

  const token = await getDriveAccessToken();
  const response = await send(token);
  if (response.status !== 401 && response.status !== 403) return response;

  await GoogleSignin.clearCachedAccessToken(token);
  return send(await getDriveAccessToken());
}

// Drive's error bodies are all shaped { error: { message, code } } - this
// pulls the human-readable part out for the dialogs that surface a failure
// to the user, which is the only place these ever reach them.
function describeApiError(json: unknown): string {
  const message = (json as { error?: { message?: string } })?.error?.message;
  return message ?? JSON.stringify(json);
}

async function describeFailedResponse(response: Response): Promise<string> {
  const json = await response.json().catch(() => null);
  return `HTTP ${response.status}: ${json ? describeApiError(json) : 'без деталей від Google'}`;
}

// Finds a folder by name (optionally under a given parent), creating it if
// missing, and caches the result under `storageKey` so repeat uploads skip
// the lookup round trip entirely.
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
    if (!folderId) {
      console.warn('[googleDrive] failed to create folder', name, createRes.status, createJson);
      throw new Error(`Не вдалося створити папку "${name}" (HTTP ${createRes.status}): ${describeApiError(createJson)}`);
    }
  }

  await AsyncStorage.setItem(storageKey, folderId!);
  return folderId!;
}

async function ensureAppFolder(): Promise<string> {
  return ensureFolder(FOLDER_ID_STORAGE_KEY, FOLDER_NAME);
}

async function ensureSubFolder(subFolder: DriveSubFolder): Promise<string> {
  const parentId = await ensureAppFolder();
  return ensureFolder(SUBFOLDER_ID_STORAGE_KEY[subFolder], subFolder, parentId);
}

// Multipart upload (metadata + base64 content in one request) - the
// simplest of Drive's upload styles and plenty for the file/photo sizes
// this app deals with. Content-Transfer-Encoding: base64 lets the media
// part carry base64 text directly instead of needing raw binary in the
// request body, which `fetch` on React Native can't build easily.
async function uploadBase64ToDrive(
  folderId: string,
  fileName: string,
  mimeType: string,
  base64Data: string
): Promise<string> {
  const boundary = 'bearlessnotes-drive-upload';
  const metadata = { name: fileName, parents: [folderId] };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Data}\r\n` +
    `--${boundary}--`;

  const response = await driveFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  const json = await response.json();
  if (!json.id) {
    console.warn('[googleDrive] upload failed', fileName, response.status, json);
    throw new Error(`Завантаження не вдалося (HTTP ${response.status}): ${describeApiError(json)}`);
  }
  return json.id as string;
}

// Current-usage counter for SettingsScreen - approximate byte size from the
// base64 payload (3 bytes per 4 base64 chars) rather than a second read of
// the original file. Best-effort: a failed stats write must never fail the
// upload/delete that already succeeded. Shared by real backups, the
// "Перевірити з'єднання" diagnostic upload, and deleteFileFromDrive (which
// subtracts back out), so it reflects what's currently on the Drive, not a
// running lifetime total.
function adjustDriveStats(bytesDelta: number, fileCountDelta: number) {
  setDoc(
    driveStatsDoc,
    { totalBytesStored: increment(bytesDelta), fileCount: increment(fileCountDelta) },
    { merge: true }
  ).catch(() => {});
}

function approxBase64Bytes(base64Data: string): number {
  return Math.floor((base64Data.length * 3) / 4);
}

async function uploadFileToDrive(
  folderId: string,
  localUri: string,
  fileName: string,
  mimeType: string
): Promise<{ fileId: string; bytes: number }> {
  const base64Data = await LegacyFileSystem.readAsStringAsync(localUri, { encoding: 'base64' });
  const fileId = await uploadBase64ToDrive(folderId, fileName, mimeType, base64Data);
  const bytes = approxBase64Bytes(base64Data);
  adjustDriveStats(bytes, 1);
  return { fileId, bytes };
}

// Fire-and-forget entry point used right after attaching a new file/photo:
// resolves to null (never throws) whenever Drive sync isn't connected or
// the upload itself fails, since a failed backup should never block
// attaching the file locally. The returned byte size is stored alongside
// driveFileId on the file/photo's own document, so a later delete-from-Drive
// knows exactly how much to subtract back out of the counter.
export async function backupFileToDrive(
  localUri: string,
  fileName: string,
  mimeType: string,
  subFolder: DriveSubFolder
): Promise<{ fileId: string; bytes: number } | null> {
  ensureConfigured();
  if (!GoogleSignin.hasPreviousSignIn()) {
    console.warn('[googleDrive] backupFileToDrive skipped - not signed in', fileName);
    return null;
  }
  try {
    const folderId = await ensureSubFolder(subFolder);
    return await uploadFileToDrive(folderId, localUri, fileName, mimeType);
  } catch (e) {
    console.warn('[googleDrive] backupFileToDrive failed', fileName, e);
    return null;
  }
}

// Restores a file/photo's local cache copy from its Drive backup when the
// device no longer has it (a fresh install, a different device, or Android
// having purged app cache under storage pressure) - the inverse of
// uploadFileToDrive. `downloadAsync` (not a fetch+base64 round trip) writes
// the response straight to disk, which is what actually matters for a
// possibly-large photo/file. Returns false (never throws) on any failure -
// callers show a plain "unavailable" state rather than surfacing an error,
// since a missing local copy with no working Drive fallback is an expected,
// recoverable-by-network state, not a bug.
export async function downloadFileFromDrive(driveFileId: string, destUri: string): Promise<boolean> {
  ensureConfigured();
  if (!GoogleSignin.hasPreviousSignIn()) return false;
  const url = `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`;
  try {
    const token = await getDriveAccessToken();
    const result = await LegacyFileSystem.downloadAsync(url, destUri, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (result.status === 401 || result.status === 403) {
      await GoogleSignin.clearCachedAccessToken(token);
      const retryToken = await getDriveAccessToken();
      const retryResult = await LegacyFileSystem.downloadAsync(url, destUri, {
        headers: { Authorization: `Bearer ${retryToken}` },
      });
      return retryResult.status === 200;
    }
    return result.status === 200;
  } catch (e) {
    console.warn('[googleDrive] downloadFileFromDrive failed', driveFileId, e);
    return false;
  }
}

// "Bearless Notes Drive test" as base64 - the diagnostic below uploads this
// tiny file rather than a real attachment, so it needs no picker and no
// local file to read.
const DIAGNOSTIC_FILE_BASE64 = 'QmVhcmxlc3MgTm90ZXMgRHJpdmUgdGVzdA==';

// Runs exactly the same path an automatic backup takes (token → folders →
// upload) and reports what happened in plain words, since the automatic
// backup itself is deliberately silent and its console warnings don't
// reliably reach a terminal when Metro runs as a background task.
export async function runDriveDiagnostics(): Promise<string> {
  ensureConfigured();
  if (!GoogleSignin.hasPreviousSignIn()) {
    return 'Немає збереженого входу Google — підключи акаунт заново.';
  }
  // An account signed in before the drive.file consent step existed carries
  // a token Drive rejects outright, so ask for the missing permission here
  // rather than making the user disconnect and reconnect.
  if (!hasDriveScope()) {
    const granted = await requestDriveScope();
    if (!granted) return 'Дозвіл на Google Drive не надано — без нього копіювання файлів неможливе.';
  }
  try {
    const folderId = await ensureSubFolder('Files');
    const fileId = await uploadBase64ToDrive(
      folderId,
      `bearless-notes-test-${Date.now()}.txt`,
      'text/plain',
      DIAGNOSTIC_FILE_BASE64
    );
    // Cleaned up right away rather than counted toward the storage-used
    // counter - it's a connectivity check, not a real backup, and leaving
    // it behind would silently inflate "скільки місця я займаю" with test
    // cruft the user never asked to keep.
    await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' });
    return `Успішно. З'єднання з Google Диском працює.`;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// Real total usage on the connected Drive ACCOUNT (all of it, not just what
// this app uploaded) - Google's own `about.get` endpoint, distinct from the
// app-tracked totalBytesStored/fileCount above (which only ever sees its own
// uploads and is an approximation from base64 length). `limit` is absent on
// an account with unlimited storage. Best-effort: resolves to null on any
// failure so a quota-check failure never breaks the rest of Settings.
export interface DriveStorageQuota {
  usage: number;
  limit: number | null;
}

export async function getDriveStorageQuota(): Promise<DriveStorageQuota | null> {
  ensureConfigured();
  if (!GoogleSignin.hasPreviousSignIn()) return null;
  try {
    const response = await driveFetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota');
    if (!response.ok) return null;
    const json = await response.json();
    const quota = json.storageQuota;
    if (!quota || quota.usage == null) return null;
    return { usage: Number(quota.usage), limit: quota.limit != null ? Number(quota.limit) : null };
  } catch (e) {
    console.warn('[googleDrive] getDriveStorageQuota failed', e);
    return null;
  }
}

// Used when the user chooses to also remove the Drive backup after deleting
// a file/photo locally. Resolves to null on success, or to the reason it
// failed - unlike a failed backup (silent on purpose), a failed delete has
// to be surfaced: the whole point of choosing "Видалити з Диску" is knowing
// the cloud copy is gone, and silently leaving it there is the one outcome
// the user must never be misled about. `bytes` (the file's own stored
// driveBytes, if known) is subtracted back out of the storage-used counter
// on success, so it reflects what's actually still on the Drive.
export async function deleteFileFromDrive(driveFileId: string, bytes?: number): Promise<string | null> {
  ensureConfigured();
  if (!GoogleSignin.hasPreviousSignIn()) return 'Google-акаунт не підключено.';
  try {
    const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
      method: 'DELETE',
    });
    if (response.ok) {
      if (bytes) adjustDriveStats(-bytes, -1);
      return null;
    }
    const reason = await describeFailedResponse(response);
    console.warn('[googleDrive] deleteFileFromDrive failed', driveFileId, reason);
    return reason;
  } catch (e) {
    console.warn('[googleDrive] deleteFileFromDrive threw', driveFileId, e);
    return e instanceof Error ? e.message : String(e);
  }
}

// What every "open this attachment" path has to go through. A file's URI
// is a path on the device that created it; on any other device that path
// simply doesn't exist, and handing it to the OS opens nothing at all.
// Same idea as useCachedAttachment, for the places that act on a file
// rather than render one.
export async function ensureLocalFile(uri: string, driveFileId?: string): Promise<boolean> {
  const info = await LegacyFileSystem.getInfoAsync(uri);
  if (info.exists) return true;
  if (!driveFileId) return false;
  return downloadFileFromDrive(driveFileId, uri);
}
