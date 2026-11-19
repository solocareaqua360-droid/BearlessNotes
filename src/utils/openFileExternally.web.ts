import { getDriveToken, hasDriveToken } from './driveToken.web';
import { fetchFromDrive } from '../hooks/useAttachmentSource.web';
import { openOnDrive, revealKeptCopy } from './desktopBridge.web';
import { askToConnectDrive } from './connectDrive.web';
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
  let token = await getDriveToken(false);
  if (!token) {
    // Not a dead end: the same window offers the connection, and the file
    // opens by itself once it is made.
    if (!(await askToConnectDrive())) return;
    token = await getDriveToken(false);
    if (!token) return;
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

// «Поділитись» in a browser: the same hand-off as opening - the file is
// fetched from Drive and put in a tab, from where the browser's own share
// and save reach it.
export async function shareFile(file: {
  fileUri: string;
  fileName: string;
  mimeType?: string;
  driveFileId?: string;
}) {
  await openFileExternally(file);
}

// «Показати у Finder»: Finder shows a file that has a real name, so the Mac's
// kept copy goes to Downloads under it and that is what is shown. A file not
// kept here yet is fetched first - asking for Drive on the way if it is not
// connected.
export async function revealFileInFinder(file: { fileName: string; driveFileId?: string }): Promise<void> {
  if (!file.driveFileId) {
    notify('Файл недоступний', 'Його копії на Google Диску немає, а локальний файл телефона Mac прочитати не може.');
    return;
  }
  let result = await revealKeptCopy(file.driveFileId, file.fileName);
  if (result === 'missing') {
    if (!hasDriveToken() && !(await askToConnectDrive())) return;
    const url = await fetchFromDrive(file.driveFileId);
    if (!url) {
      notify('Не вдалося забрати файл', 'Диск не віддав його.');
      return;
    }
    // Kept in the background by the fetch; give it a moment to land.
    for (let attempt = 0; attempt < 8 && result === 'missing'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      result = await revealKeptCopy(file.driveFileId, file.fileName);
    }
  }
  if (result !== 'shown') notify('Не вдалося показати у Finder', 'Спробуй «Завантажити» - система запитає, куди зберегти.');
}

// «Відкрити на Google Диску»: the file's own page, in the real browser.
export async function openFileOnDrive(file: { driveFileId?: string }): Promise<void> {
  if (!file.driveFileId) {
    notify('Файл недоступний', 'Його копії на Google Диску немає.');
    return;
  }
  await openOnDrive(file.driveFileId);
}
