import { bytesOf } from './downloadToFolder.web';

// The browser's version: there is no file to read, so the bytes come the
// way a download's do - the page's own address, the copy kept for an upload
// that is waiting, then Drive (2026-10-09, the note's export on the Mac
// said «[Зображення]» for every picture).
export async function imageBase64(uri: string, driveFileId?: string): Promise<string> {
  const blob = await bytesOf(uri, driveFileId);
  if (!blob) throw new Error('no bytes');
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buffer.length; i += 0x8000) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
