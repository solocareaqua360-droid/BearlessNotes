import { linkForCopy } from './linkId';
import { notify } from '../components/surfaces/Ask';
import { bytesOf } from './downloadToFolder.web';

// The browser build of shareAndCopy: the same three words, done with the
// browser's own tools. A picture arrives as a blob: or an https address.

async function pictureBlob(uri: string, driveFileId?: string): Promise<Blob> {
  const blob = await bytesOf(uri, driveFileId);
  if (!blob) throw new Error('Не вдалося отримати зображення');
  return blob;
}

// The clipboard takes PNG only, so anything else is redrawn first.
async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('Не вдалося перетворити зображення'))), 'image/png')
  );
}

export async function shareImageFile(uri: string, driveFileId?: string, title?: string): Promise<void> {
  try {
    const blob = await pictureBlob(uri, driveFileId);
    const file = new File([blob], `${title || 'image'}.${(blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`, {
      type: blob.type,
    });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
    else notify('Поділитись у браузері недоступно', 'Скористайся «Копіювати» або «Завантажити».');
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') notify('Не вдалося поділитись', e instanceof Error ? e.message : String(e));
  }
}

export async function copyImageFile(uri: string, driveFileId?: string): Promise<void> {
  try {
    const png = await asPng(await pictureBlob(uri, driveFileId));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  } catch (e) {
    notify('Не вдалося скопіювати зображення', e instanceof Error ? e.message : String(e));
  }
}

export async function copyLinkText(raw: string): Promise<void> {
  const text = linkForCopy(raw);
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    notify('Не вдалося скопіювати', e instanceof Error ? e.message : String(e));
  }
}
