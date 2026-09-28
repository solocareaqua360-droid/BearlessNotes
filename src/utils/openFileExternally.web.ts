import { getDriveToken } from './driveToken.web';
import { notify } from '../components/surfaces/Ask';

// "Open this file with something else" - in a browser, that means handing
// it to the browser.
//
// The phone's version hands a content:// URI to Android's intent system,
// which is the whole of what "open elsewhere" means there. Neither half
// exists here: there is no intent system, and the stored path is a file on
// the phone that this page may not read. What there is instead is the
// Drive copy, and a tab to put it in.

export async function ensureFileIsHere(file: {
  fileUri: string;
  driveFileId?: string;
}): Promise<boolean> {
  // Nothing is ever "here" in a browser - there is no local cache to
  // restore into. A file is reachable exactly when Drive has it.
  if (file.driveFileId) return true;
  notify('Файл недоступний', 'Його копії на Google Диску немає, а локальний файл телефона браузер прочитати не може.');
  return false;
}

export async function openFileExternally(file: {
  fileUri: string;
  fileName: string;
  mimeType?: string;
  driveFileId?: string;
}) {
  if (!file.driveFileId) {
    notify('Файл недоступний', 'Його копії на Google Диску немає, а локальний файл телефона браузер прочитати не може.');
    return;
  }
  const token = await getDriveToken(false);
  if (!token) {
    notify('Диск не підключений', 'Підключи Google Диск, щоб відкривати файли тут.');
    return;
  }
  // Fetched with the token rather than linked to: a Drive download URL is
  // not public, and a plain <a href> carries no Authorization header. The
  // blob then opens like any other page.
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${file.driveFileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!response || !response.ok) {
    notify('Не вдалося відкрити', 'Диск не віддав цей файл.');
    return;
  }
  const url = URL.createObjectURL(await response.blob());
  window.open(url, '_blank', 'noopener');
  // Revoked late: revoking straight away can beat the new tab to it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
