import { notify } from '../components/surfaces/Ask';
import { fetchFromDrive } from '../hooks/useAttachmentSource.web';
import { readPending } from './pendingUploads';

// Saving a file to a folder of the user's choosing - in a browser, no.
//
// The phone's version copies bytes from the app's own cache into a
// folder the user picked once through Android's document picker, and
// remembers that folder. None of those three things exists here: the
// source is a path on the phone, there is no picker of that kind, and a
// page cannot write to a folder at all.
//
// What a browser has instead is the tab. openFileExternally.web fetches
// the Drive copy and opens it in one, and from there the browser's own
// save does the rest - which is the way every file on the web is saved.
// So these say so rather than throwing into a promise nobody is
// watching, which is what the phone's version did here: the button
// appeared to do nothing.
export async function currentDownloadFolder(): Promise<{ uri: string; label: string } | null> {
  return null;
}

export async function chooseDownloadFolder(): Promise<{ uri: string; label: string } | null> {
  notify('Тека для завантажень', 'У браузері файли зберігаються через саму вкладку: відкрий файл і збережи його там.');
  return null;
}

export async function downloadToFolder(
  uri: string,
  fileName: string,
  mimeType: string,
  driveFileId?: string
): Promise<{ destUri: string; fileName: string } | null> {
  const blob = await bytesOf(uri, driveFileId);
  if (!blob) {
    notify('Файл недоступний', 'Його немає на цьому пристрої, а копії на Google Диску теж немає або Диск не підключений.');
    return null;
  }
  // A real download: the Mac app's window answers it with the system's own
  // «Зберегти як» dialog, a browser with its downloads bar (2026-10-09 - it
  // used to say "open the file in a tab", which the Mac app has no tabs for).
  const url = URL.createObjectURL(mimeType ? new Blob([blob], { type: mimeType }) : blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = withExtension(fileName, mimeType);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  // Null: nothing was written to a folder this page knows, so there is no
  // «Показати в теці» toast to offer - the system's dialog was the answer.
  return null;
}

// A title like «Звіт» saved as a bare name would open with nothing; the
// extension the type implies is added when the name has none.
const EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'text/plain': '.txt',
  'video/mp4': '.mp4',
  'application/zip': '.zip',
};
function withExtension(name: string, mimeType: string): string {
  if (/\.[A-Za-z0-9]{1,5}$/.test(name)) return name;
  return name + (EXTENSIONS[mimeType] ?? '');
}

// The file's bytes: the address while this page holds it, the copy kept for
// an upload that is still waiting, then Drive (through the desktop disk
// keep when there is one).
export async function bytesOf(uri: string, driveFileId?: string): Promise<Blob | null> {
  if (!uri.startsWith('file:')) {
    try {
      const response = await fetch(uri);
      if (response.ok) return await response.blob();
    } catch {
      // Dead blob: URL after a reload - the kept copy or Drive is next.
    }
  }
  if (uri.startsWith('blob:')) {
    const kept = await readPending(uri);
    if (kept) return kept;
  }
  if (!driveFileId) return null;
  const url = await fetchFromDrive(driveFileId);
  if (!url) return null;
  try {
    const response = await fetch(url);
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

// Showing a file that was just saved. On the phone this fires a VIEW
// intent at the content:// URI the download produced; here there is no
// such URI and no such intent, because nothing was written to a folder
// in the first place - downloadToFolder above says so and returns null.
//
// Kept because PhotosScreen calls it, and a missing export is not a
// no-op: the browser build crashes on the symbol itself.
export async function showDownloadedFile(_uri: string, _mimeType: string): Promise<void> {
  notify('Файл у вкладці', 'У браузері файл відкривається у новій вкладці - звідти його зберігає сам браузер.');
}
