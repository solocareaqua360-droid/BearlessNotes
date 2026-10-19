import { useMemo, useState, type ReactNode } from 'react';
import ItemFoldersSheet from '../components/ItemFoldersSheet';
import { notify } from '../components/surfaces/Ask';
import type { Tag } from '../types';

// «У ПРОВІДНИК» FROM A BASE (the user, 2026-10-11, the video base first): put one thing, or several chosen
// ones, into folders of the explorer - a list of EVERY folder there is, tick any number, save. A thing in a
// folder is shown there (the explorer shows only what was put in it); this is the explicit command for it,
// where the base's own «Папки»/tags were not clear. `node` is rendered once on the screen.
export type FilableThing = { id: string; tagKind: string; collection: string; tagIds: string[] };

export function useFileInExplorer({
  tags,
  attachTag,
  detachTag,
  createFolderTag,
}: {
  tags: Tag[];
  attachTag: (tag: Tag, kind: never, itemId: string, collection: string) => Promise<void>;
  detachTag: (tag: Tag, kind: never, itemId: string, collection: string) => Promise<void>;
  createFolderTag: (path: string, types: never, color: string) => Promise<string>;
}): { open: (things: FilableThing[]) => void; node: ReactNode } {
  const [things, setThings] = useState<FilableThing[] | null>(null);
  const paths = useMemo(() => Array.from(new Set(tags.map((t) => t.path))).sort((a, b) => a.localeCompare(b)), [tags]);
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  // The folders ALL the chosen things already stand in.
  const shared = useMemo(() => {
    if (!things || things.length === 0) return [] as string[];
    const sets = things.map((t) => new Set(t.tagIds.map((id) => tagById.get(id)?.path).filter((p): p is string => !!p)));
    return Array.from(sets[0]).filter((p) => sets.every((s) => s.has(p)));
  }, [things, tagById]);

  // The tag standing for a folder: an existing one (the one with the most kinds), else a new universal one.
  async function tagForPath(folder: string): Promise<Tag> {
    const same = tags.filter((t) => t.path === folder).sort((a, b) => b.types.length - a.types.length);
    if (same.length) return same[0];
    const color = '#DAA587';
    const id = await createFolderTag(folder, [] as never, color);
    return { id, path: folder, icon: 'folder-outline', color, types: [], usedIn: {}, keep: true } as Tag;
  }

  async function save(add: string[], remove: string[]) {
    const list = things ?? [];
    setThings(null);
    try {
      for (const folder of add) {
        const target = await tagForPath(folder);
        for (const t of list) {
          if (!tags.some((x) => x.path === folder && t.tagIds.includes(x.id))) await attachTag(target, t.tagKind as never, t.id, t.collection);
        }
      }
      for (const folder of remove) {
        for (const t of list) {
          for (const tag of tags.filter((x) => x.path === folder && t.tagIds.includes(x.id))) await detachTag(tag, t.tagKind as never, t.id, t.collection);
        }
      }
    } catch (e) {
      notify('Не вдалося', (e as Error).message);
    }
  }

  const node = (
    <ItemFoldersSheet visible={things !== null} paths={paths} initial={shared} count={things?.length ?? 0} onSave={save} onClose={() => setThings(null)} />
  );
  return { open: setThings, node };
}
