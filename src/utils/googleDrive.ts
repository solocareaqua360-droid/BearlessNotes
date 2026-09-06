import { GoogleSignin } from '@react-native-google-signin/google-signin';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFileSystem from 'expo-file-system/legacy';

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

// Throws on cancel/failure - the Settings screen shows that as "not
// connected" rather than treating it as a real error.
export async function connectGoogleDrive(): Promise<string> {
  ensureConfigured();
  await GoogleSignin.hasPlayServices();
  const response = await GoogleSignin.signIn();
  if (response.type !== 'success') throw new Error('cancelled');
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

// Drive's error bodies are all shaped { error: { message, code } } - this
// pulls the human-readable part out for the "Перевірити з'єднання" dialog,
// which is the only place these ever reach the user.
function describeApiError(json: unknown): string {
  const message = (json as { error?: { message?: string } })?.error?.message;
  return message ?? JSON.stringify(json);
}

// Finds a folder by name (optionally under a given parent), creating it if
// missing, and caches the result under `storageKey` so repeat uploads skip
// the lookup round trip entirely.
async function ensureFolder(
  accessToken: string,
  storageKey: string,
  name: string,
  parentId?: string
): Promise<string> {
  const cached = await AsyncStorage.getItem(storageKey);
  if (cached) return cached;

  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const query = encodeURIComponent(
    `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`
  );
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listJson = await listRes.json();
  let folderId: string | undefined = listJson.files?.[0]?.id;

  if (!folderId) {
    const metadata: Record<string, unknown> = { name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) metadata.parents = [parentId];
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
    const createJson = await createRes.json();
    folderId = createJson.id;
    if (!folderId) {
      console.warn('[googleDrive] failed to create folder', name, createRes.status, createJson);
      throw new Error(
        `Не вдалося створити папку "${name}" (HTTP ${createRes.status}): ${describeApiError(createJson)}`
      );
    }
  }

  await AsyncStorage.setItem(storageKey, folderId!);
  return folderId!;
}

async function ensureAppFolder(accessToken: string): Promise<string> {
  return ensureFolder(accessToken, FOLDER_ID_STORAGE_KEY, FOLDER_NAME);
}

async function ensureSubFolder(accessToken: string, subFolder: DriveSubFolder): Promise<string> {
  const parentId = await ensureAppFolder(accessToken);
  return ensureFolder(accessToken, SUBFOLDER_ID_STORAGE_KEY[subFolder], subFolder, parentId);
}

// Multipart upload (metadata + base64 content in one request) - the
// simplest of Drive's upload styles and plenty for the file/photo sizes
// this app deals with. Content-Transfer-Encoding: base64 lets the media
// part carry base64 text directly instead of needing raw binary in the
// request body, which `fetch` on React Native can't build easily.
async function uploadBase64ToDrive(
  accessToken: string,
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

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const json = await response.json();
  if (!json.id) {
    console.warn('[googleDrive] upload failed', fileName, response.status, json);
    throw new Error(`Завантаження не вдалося (HTTP ${response.status}): ${describeApiError(json)}`);
  }
  return json.id as string;
}

async function uploadFileToDrive(
  accessToken: string,
  folderId: string,
  localUri: string,
  fileName: string,
  mimeType: string
): Promise<string> {
  const base64Data = await LegacyFileSystem.readAsStringAsync(localUri, { encoding: 'base64' });
  return uploadBase64ToDrive(accessToken, folderId, fileName, mimeType, base64Data);
}

// Fire-and-forget entry point used right after attaching a new file/photo:
// resolves to null (never throws) whenever Drive sync isn't connected or
// the upload itself fails, since a failed backup should never block
// attaching the file locally.
export async function backupFileToDrive(
  localUri: string,
  fileName: string,
  mimeType: string,
  subFolder: DriveSubFolder
): Promise<string | null> {
  ensureConfigured();
  if (!GoogleSignin.hasPreviousSignIn()) {
    console.warn('[googleDrive] backupFileToDrive skipped - not signed in', fileName);
    return null;
  }
  try {
    const accessToken = await getDriveAccessToken();
    const folderId = await ensureSubFolder(accessToken, subFolder);
    return await uploadFileToDrive(accessToken, folderId, localUri, fileName, mimeType);
  } catch (e) {
    console.warn('[googleDrive] backupFileToDrive failed', fileName, e);
    return null;
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
  let accessToken: string;
  try {
    accessToken = await getDriveAccessToken();
  } catch (e) {
    return `Не вдалося отримати токен доступу: ${e instanceof Error ? e.message : String(e)}`;
  }
  try {
    const folderId = await ensureSubFolder(accessToken, 'Files');
    const fileId = await uploadBase64ToDrive(
      accessToken,
      folderId,
      `bearless-notes-test-${Date.now()}.txt`,
      'text/plain',
      DIAGNOSTIC_FILE_BASE64
    );
    return `Успішно. Тестовий файл завантажено в "Bearless Notes/Files" (id ${fileId}).`;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// Used when the user chooses to also remove the Drive backup after deleting
// a file/photo locally - never throws, since a failed cloud delete should
// never block the local delete that already happened.
export async function deleteFileFromDrive(driveFileId: string): Promise<boolean> {
  ensureConfigured();
  if (!GoogleSignin.hasPreviousSignIn()) return false;
  try {
    const accessToken = await getDriveAccessToken();
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) console.warn('[googleDrive] deleteFileFromDrive failed', driveFileId, response.status);
    return response.ok;
  } catch (e) {
    console.warn('[googleDrive] deleteFileFromDrive threw', driveFileId, e);
    return false;
  }
}
