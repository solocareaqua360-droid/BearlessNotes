import type { Tag } from '../types';

// THE EXPLORER'S FOLDERS, AS A CONVERSATION CAN POINT AT THEM (2026-10-24, the user: a chat gets a folder only when he chooses,
// at any moment; the chat has no folders of its own). A folder of the explorer is a tag with a `path` («Розробка/ШІ»); one that is
// only the way to deeper folders has no tag yet. So the pointer is the tag's id when there is one, else «implied:<path>» - the
// explorer's own stand-in (useTags.setTagFields). The same filter as the explorer's: a base's own collections are not folders
// until placed, and the built-in «Нерозкладене» is not a folder.
const UNFILED = '​Нерозкладене';

export type FolderOption = { id: string; path: string; name: string; depth: number };

export function folderOptions(allTags: Tag[]): FolderOption[] {
  const placed = allTags.filter((t) => t.baseOnly && t.inExplorer).map((t) => t.path);
  const isPlaced = (path: string) => placed.some((p) => path === p || path.startsWith(`${p}/`));
  const tags = allTags.filter((t) => (!t.baseOnly || isPlaced(t.path)) && t.path !== UNFILED);
  const byPath = new Map(tags.map((t) => [t.path, t]));
  const paths = new Set<string>();
  tags.forEach((t) => {
    const parts = t.path.split('/');
    for (let i = 1; i <= parts.length; i += 1) paths.add(parts.slice(0, i).join('/'));
  });
  // Tree order: a folder, then what is in it (plain sort puts «a» before «a/b» before «a b»? the slash is compared as a character,
  // so sort by the path split into parts instead).
  return [...paths]
    .sort((a, b) => {
      const x = a.split('/');
      const y = b.split('/');
      for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
        const c = x[i].localeCompare(y[i], 'uk');
        if (c !== 0) return c;
      }
      return x.length - y.length;
    })
    .map((path) => {
      const parts = path.split('/');
      return { id: byPath.get(path)?.id ?? `implied:${path}`, path, name: parts[parts.length - 1], depth: parts.length - 1 };
    });
}

// A pointer back to the folder it names (null: the folder is gone - the chat then simply reads as «without a folder»).
export function folderOfPointer(options: FolderOption[], folderId: string | undefined): FolderOption | null {
  if (!folderId) return null;
  return options.find((o) => o.id === folderId) ?? (folderId.startsWith('implied:') ? options.find((o) => o.path === folderId.slice('implied:'.length)) ?? null : null);
}
