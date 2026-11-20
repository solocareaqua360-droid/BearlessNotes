import * as LegacyFileSystem from 'expo-file-system/legacy';
import { ensureLocalFile } from './googleDrive';
import { localPathFor } from './localPath';
import { documentToMarkdown } from './blocksText';
import { sanitizeFileName } from './documentBlocks';
import { base64ToBytes, bytesToBase64, utf8, writeZip, type ZipEntry } from './zip';
import type { FolderItem } from '../hooks/useAllFolderItems';
import type { Block, Tag } from '../types';

// A FOLDER AS A ZIP (2026-10-31, the user's «експорт папки в zip»): the folder and every folder under it, as folders of the archive.
// A note is a .md file (utils/blocksText documentToMarkdown) with its pictures and files beside it in «files/», linked from the text;
// a photo or a file of the folder is itself; the links of a folder are one «Посилання.md». Boards, cards and records are not files and
// are left out (said in `skipped`). A picture kept only on Drive is fetched first; one that cannot be had is left out and counted.
export async function folderToZip(
  folderPath: string,
  folderName: string,
  tags: Tag[],
  items: FolderItem[]
): Promise<{ base64: string; files: number; skipped: number }> {
  const branch = tags.filter((t) => t.path === folderPath || t.path.startsWith(`${folderPath}/`));
  const branchIds = new Set(branch.map((t) => t.id));
  const pathOfTag = new Map(branch.map((t) => [t.id, t.path]));
  const root = sanitizeFileName(folderName) || 'Папка';
  const entries: ZipEntry[] = [];
  const taken = new Set<string>();
  let skipped = 0;

  // The archive's folder for an item: the deepest of its folders inside this one.
  const dirOf = (item: FolderItem) => {
    const paths = item.tagIds.map((id) => pathOfTag.get(id)).filter((p): p is string => !!p);
    const deepest = paths.sort((a, b) => b.length - a.length)[0] ?? folderPath;
    const rel = deepest.slice(folderPath.length).split('/').filter(Boolean).map((p) => sanitizeFileName(p) || 'Папка');
    return [root, ...rel].join('/');
  };
  const unique = (dir: string, name: string) => {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = `${dir}/${name}`;
    for (let n = 2; taken.has(candidate); n++) candidate = `${dir}/${stem} (${n})${ext}`;
    taken.add(candidate);
    return candidate;
  };
  const bytesOf = async (uri: string | undefined, driveFileId?: string): Promise<Uint8Array | null> => {
    if (!uri && !driveFileId) return null;
    try {
      if (!(await ensureLocalFile(uri ?? '', driveFileId))) return null;
      const base64 = await LegacyFileSystem.readAsStringAsync(localPathFor(uri ?? '', driveFileId) as string, { encoding: 'base64' });
      return base64ToBytes(base64);
    } catch {
      return null;
    }
  };
  const extOf = (name: string | undefined, fallback: string) => {
    const m = (name ?? '').match(/\.[A-Za-z0-9]{1,5}$/);
    return m ? m[0] : fallback;
  };

  const links = new Map<string, string[]>();
  const inside = items.filter(
    (i) => !(i.raw as Record<string, unknown> | undefined)?.deletedAt && i.tagIds.some((id) => branchIds.has(id))
  );
  for (const item of inside) {
    const raw = (item.raw ?? {}) as Record<string, unknown>;
    const dir = dirOf(item);
    if (item.kind === 'document') {
      const blocks: Block[] = item.blocks ?? [];
      // The note's own pictures and files, saved beside it and named in its text.
      const assets = new Map<string, string>();
      for (const b of blocks) {
        const isImage = b.type === 'image';
        const isFile = b.type === 'file';
        if (!isImage && !isFile) continue;
        const bytes = await bytesOf(isImage ? b.imageUri : b.fileUri, b.driveFileId);
        if (!bytes) {
          skipped += 1;
          continue;
        }
        const name = isImage ? `${sanitizeFileName(b.imageTitle || 'Фото')}${extOf(b.imageUri, '.jpg')}` : sanitizeFileName(b.fileName || 'Файл');
        const path = unique(`${dir}/files`, name);
        entries.push({ path, bytes });
        assets.set(b.id, path.slice(dir.length + 1));
      }
      const md = documentToMarkdown(item.title, blocks, (b) => assets.get(b.id) ?? null);
      entries.push({ path: unique(dir, `${sanitizeFileName(item.title) || 'Без назви'}.md`), bytes: utf8(md) });
    } else if (item.kind === 'photo') {
      const bytes = await bytesOf(item.imageUri ?? (raw.imageUri as string | undefined), item.driveFileId ?? (raw.driveFileId as string | undefined));
      if (!bytes) {
        skipped += 1;
        continue;
      }
      entries.push({ path: unique(dir, `${sanitizeFileName(item.title) || 'Фото'}${extOf(raw.imageUri as string, '.jpg')}`), bytes });
    } else if (item.kind === 'file') {
      const bytes = await bytesOf(raw.fileUri as string | undefined, raw.driveFileId as string | undefined);
      if (!bytes) {
        skipped += 1;
        continue;
      }
      entries.push({ path: unique(dir, sanitizeFileName((raw.fileName as string) || item.title) || 'Файл'), bytes });
    } else if (item.kind === 'link') {
      const url = raw.url as string | undefined;
      if (!url) continue;
      const list = links.get(dir) ?? [];
      list.push(`- [${item.title.replace(/[[\]]/g, '')}](${url})`);
      links.set(dir, list);
    } else {
      skipped += 1;
    }
  }
  links.forEach((list, dir) => entries.push({ path: unique(dir, 'Посилання.md'), bytes: utf8(`# Посилання\n\n${list.join('\n')}\n`) }));
  return { base64: bytesToBase64(writeZip(entries)), files: entries.length, skipped };
}
