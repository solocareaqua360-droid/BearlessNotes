import { GoogleSignin } from '@react-native-google-signin/google-signin';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFileSystem from 'expo-file-system/legacy';

// drive.file (not the full "drive" scope) - this app can only see/manage
// files it creates itself, never the rest of the user's Drive.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Bearless Notes';
const FOLDER_ID_STORAGE_KEY = 'bearlessNotes.driveFolderId';

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
  await AsyncStorage.removeItem(FOLDER_ID_STORAGE_KEY);
}

async function getDriveAccessToken(): Promise<string> {
  ensureConfigured();
  await GoogleSignin.signInSilently();
  const { accessToken } = await GoogleSignin.getTokens();
  return accessToken;
}

// Cached after the first lookup/creation so every subsequent upload skips
// the extra "does this folder already exist" round trip.
async function ensureAppFolder(accessToken: string): Promise<string> {
  const cached = await AsyncStorage.getItem(FOLDER_ID_STORAGE_KEY);
  if (cached) return cached;

  const query = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listJson = await listRes.json();
  let folderId: string | undefined = listJson.files?.[0]?.id;

  if (!folderId) {
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    });
    const createJson = await createRes.json();
    folderId = createJson.id;
  }

  await AsyncStorage.setItem(FOLDER_ID_STORAGE_KEY, folderId!);
  return folderId!;
}

// Multipart upload (metadata + base64 content in one request) - the
// simplest of Drive's upload styles and plenty for the file/photo sizes
// this app deals with. Content-Transfer-Encoding: base64 lets the media
// part carry base64 text directly instead of needing raw binary in the
// request body, which `fetch` on React Native can't build easily.
async function uploadFileToDrive(
  accessToken: string,
  folderId: string,
  localUri: string,
  fileName: string,
  mimeType: string
): Promise<string> {
  const base64Data = await LegacyFileSystem.readAsStringAsync(localUri, { encoding: 'base64' });
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
  if (!json.id) throw new Error('Drive upload failed');
  return json.id as string;
}

// Fire-and-forget entry point used right after attaching a new file/photo:
// resolves to null (never throws) whenever Drive sync isn't connected or
// the upload itself fails, since a failed backup should never block
// attaching the file locally.
export async function backupFileToDrive(
  localUri: string,
  fileName: string,
  mimeType: string
): Promise<string | null> {
  ensureConfigured();
  if (!GoogleSignin.hasPreviousSignIn()) return null;
  try {
    const accessToken = await getDriveAccessToken();
    const folderId = await ensureAppFolder(accessToken);
    return await uploadFileToDrive(accessToken, folderId, localUri, fileName, mimeType);
  } catch {
    return null;
  }
}
