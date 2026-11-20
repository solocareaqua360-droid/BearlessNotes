import { bytesOf } from './downloadToFolder.web';
import { isDesktopShell } from './desktopBridge.web';

// See handoffExport.ts. Only inside the Mac app: the browser has no folder
// to write to.
export type HandoffItem = { key: string; name: string; uri: string; driveFileId?: string };

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'video/mp4': '.mp4',
};

async function put(folder: string, file: string, body: Blob | string): Promise<string | null> {
  try {
    const response = await fetch(`/__desktop/export/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`, {
      method: 'PUT',
      headers: { 'X-Mindeva': '1' },
      body,
    });
    if (!response.ok) return null;
    return ((await response.json()) as { path?: string }).path ?? null;
  } catch {
    return null;
  }
}

// Every picture/file that could be read, written as «скрін-<n>-<name>.<ext>»;
// the answer is key -> where it now lies. One that cannot be read (no bytes
// here, no Drive) is simply absent: the text will name it instead.
export async function saveHandoffFiles(
  folder: string,
  items: HandoffItem[]
): Promise<Record<string, string> | null> {
  if (!isDesktopShell()) return null;
  const paths: Record<string, string> = {};
  let n = 0;
  for (const item of items) {
    const blob = await bytesOf(item.uri, item.driveFileId);
    if (!blob) continue;
    n += 1;
    const base = item.name.replace(/[\\/:*?"<>|\0]/g, '_').replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'файл';
    const ext = (item.name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0]) ?? EXTENSIONS[blob.type] ?? '';
    const path = await put(folder, `скрін-${n}-${base}${ext}`, blob);
    if (path) paths[item.key] = path;
  }
  return paths;
}

export async function saveHandoffText(folder: string, name: string, text: string): Promise<string | null> {
  if (!isDesktopShell()) return null;
  return put(folder, name, new Blob([text], { type: 'text/markdown;charset=utf-8' }));
}
