import { linkForCopy } from './linkId';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { notify } from '../components/surfaces/Ask';
import { ensureLocalFile } from './googleDrive';
import { localPathFor } from './localPath';

// «Поділитись» and «Копіювати» for a picture, in ONE place - the photo
// list, the photo viewer and the note's image viewer all called
// Sharing.shareAsync(photo.imageUri) by hand and swallowed whatever went
// wrong ("нічого не робити"), so a picture whose file was not on this
// phone (another device made it, the cache was cleared, a blob: from the
// browser) simply did nothing. Now the file is first brought to this
// phone (the Drive copy), the system is told it is an image (a path with
// no extension carries no type), and a failure is SAID.

function imageMime(path: string): string {
  const ext = path.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

async function readyPicture(uri: string, driveFileId?: string): Promise<string | null> {
  const path = localPathFor(uri, driveFileId) as string;
  // A flattened drawing is a tmp file made a moment ago - already here.
  if (await ensureLocalFile(uri, driveFileId)) return path;
  return null;
}

export async function shareImageFile(uri: string, driveFileId?: string, title?: string): Promise<void> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      notify('Поділитись тут недоступно', 'На цьому пристрої немає системного меню «Поділитись».');
      return;
    }
    const path = await readyPicture(uri, driveFileId);
    if (!path) {
      notify('Зображення недоступне', 'Файлу немає на цьому пристрої, і копії на Диску теж не знайдено.');
      return;
    }
    await Sharing.shareAsync(path, { mimeType: imageMime(path), dialogTitle: title });
  } catch (e) {
    notify('Не вдалося поділитись', e instanceof Error ? e.message : String(e));
  }
}

// The picture's own bytes onto the system clipboard - pasteable into a
// chat or a mail. (Pasting into a NOTE of this app still makes a second
// copy; the app's own «Копіювати» for blocks is a different thing, see
// objectClipboard.)
export async function copyImageFile(uri: string, driveFileId?: string): Promise<void> {
  try {
    const path = await readyPicture(uri, driveFileId);
    if (!path) {
      notify('Зображення недоступне', 'Файлу немає на цьому пристрої, і копії на Диску теж не знайдено.');
      return;
    }
    const base64 = await LegacyFileSystem.readAsStringAsync(path, { encoding: 'base64' });
    await Clipboard.setImageAsync(base64);
  } catch (e) {
    notify('Не вдалося скопіювати зображення', e instanceof Error ? e.message : String(e));
  }
}

// A link, a video's address, a place's map link: the text alone. Android
// 13+ says "Скопійовано" itself; older Androids get a short notice.
export async function copyLinkText(raw: string): Promise<void> {
  const text = linkForCopy(raw);
  try {
    await Clipboard.setStringAsync(text);
  } catch (e) {
    notify('Не вдалося скопіювати', e instanceof Error ? e.message : String(e));
  }
}
