import { useRef, useState } from 'react';
import { Tag, TaggableKind } from '../types';
import { TAG_COLORS } from '../constants/tags';
import { ask, confirm } from '../components/surfaces/Ask';

// The explorer, as a thing a database can have rather than something the
// documents screen does.
//
// A folder is a SEGMENT OF A TAG'S PATH - "робота/оренда" is the folder
// "робота" holding the folder "оренда" - so the tree is read straight off
// the tags and nothing is stored for it. What a level shows is the file
// manager's answer: the folders directly under it, and the records tagged
// with exactly this path, not with anything deeper, which is what the next
// folder is for. At the root, the records that carry no tag at all.
//
// All of this lived inside DocumentsScreen, where it was written. Boards
// need the same thing, and a second copy of four hundred lines is two
// screens that drift - so it is here, taking the one database-shaped
// thing it needs (a kind, a collection, and the tag API it writes
// through) as arguments.

export type ExplorerFolder = {
  name: string;
  fullPath: string;
  tag: Tag | undefined;
  // Every record anywhere under it, which is what a file manager's
  // "items" means for a folder.
  count: number;
  // The two small numbers ON a folder: the records directly in it (not in
  // its sub-folders), and the sub-folders directly in it.
  docs: number;
  subfolders: number;
};

export type FolderPrompt =
  | { mode: 'new'; parent: string }
  | { mode: 'rename'; path: string };

export type ExplorerOptions<T extends { id: string }> = {
  kind: TaggableKind;
  // Where this database's records live, for attachTag's sake.
  collection: string;
  // Everything in the database, for the counts on a folder - not the
  // filtered list, or a folder's number would change with a search.
  items: T[];
  // What the filters and the search left, which is what a level lists.
  displayed: T[];
  tagIdsOf: (item: T) => string[];
  // Every tag of this kind, and the ones the drawer is willing to show.
  // An empty folder made on purpose (Tag.keep) is in the first and not
  // the second, and the explorer wants it: in this mode an empty folder
  // IS a folder. That is the user's own rule for the two modes.
  tags: Tag[];
  drawerTags: Tag[];
  explorerMode: boolean;
  searching: boolean;
  needle: string;
  createFolderTag: (path: string, kind: TaggableKind, color: string) => Promise<string>;
  deleteTagCompletely: (tag: Tag) => Promise<void>;
  renameTag: (tag: Tag, newPath: string) => Promise<void>;
  attachTag: (tag: Tag, kind: TaggableKind, itemId: string, itemsCollection: string) => Promise<void>;
  detachTag: (tag: Tag, kind: TaggableKind, itemId: string, itemsCollection: string) => Promise<void>;
};

const cleanName = (name: string) => name.trim().replace(/\//g, ' ');
export const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');
export const nameOf = (path: string) => path.split('/').pop() ?? path;
const randomColor = () => TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];

export function useExplorer<T extends { id: string }>(options: ExplorerOptions<T>) {
  const {
    kind,
    collection,
    items,
    displayed,
    tagIdsOf,
    tags,
    drawerTags,
    explorerMode,
    searching,
    needle,
    createFolderTag,
    deleteTagCompletely,
    renameTag,
    attachTag,
    detachTag,
  } = options;

  const [path, setPathState] = useState('');
  const [folderPrompt, setFolderPrompt] = useState<FolderPrompt | null>(null);

  // Where you have been, for the rail's back/forward: a plain history like
  // a browser's. Going somewhere new cuts off whatever was "forward"; back
  // and forward only move along what is there, and do nothing at either
  // end - the user's rule: forward into a folder you have not been to is
  // no action at all.
  const historyRef = useRef<{ paths: string[]; index: number }>({ paths: [''], index: 0 });
  const [historyState, setHistoryState] = useState({ canBack: false, canForward: false });
  function syncHistoryState() {
    const h = historyRef.current;
    setHistoryState({ canBack: h.index > 0, canForward: h.index < h.paths.length - 1 });
  }
  function setPath(next: string | ((prev: string) => string)) {
    const h = historyRef.current;
    const value = typeof next === 'function' ? next(h.paths[h.index]) : next;
    if (value === h.paths[h.index]) return;
    h.paths = [...h.paths.slice(0, h.index + 1), value];
    h.index = h.paths.length - 1;
    setPathState(value);
    syncHistoryState();
  }
  function back() {
    const h = historyRef.current;
    if (h.index === 0) return;
    h.index -= 1;
    setPathState(h.paths[h.index]);
    syncHistoryState();
  }
  function forward() {
    const h = historyRef.current;
    if (h.index >= h.paths.length - 1) return;
    h.index += 1;
    setPathState(h.paths[h.index]);
    syncHistoryState();
  }

  // Searching reaches the whole tree, so while it does the explorer is
  // not "in" a folder at all.
  const active = explorerMode && !searching;
  const explorerTags = tags.filter((t) => t.types.includes(kind) || drawerTags.some((d) => d.id === t.id));
  const tagByPath = new Map(explorerTags.map((t) => [t.path, t]));

  function directDocs(fullPath: string): number {
    const own = tagByPath.get(fullPath);
    return own ? items.filter((item) => tagIdsOf(item).includes(own.id)).length : 0;
  }
  function directSubfolders(fullPath: string): number {
    const prefix = `${fullPath}/`;
    return new Set(
      explorerTags.filter((t) => t.path.startsWith(prefix)).map((t) => t.path.slice(prefix.length).split('/')[0])
    ).size;
  }
  function countInside(fullPath: string): number {
    const inside = new Set(
      explorerTags.filter((t) => t.path === fullPath || t.path.startsWith(`${fullPath}/`)).map((t) => t.id)
    );
    return items.filter((item) => tagIdsOf(item).some((id) => inside.has(id))).length;
  }

  const folders: ExplorerFolder[] = (() => {
    if (!explorerMode) return [];
    // Searching: every folder whose name has the words, from the whole
    // tree, shown with its path - a search that found the records but not
    // the folders would be half a search.
    if (searching) {
      return explorerTags
        .filter((t) => t.path.toLowerCase().includes(needle.toLowerCase()))
        .map((t) => ({
          name: t.path.split('/').join('  /  '),
          fullPath: t.path,
          tag: t,
          count: countInside(t.path),
          docs: directDocs(t.path),
          subfolders: directSubfolders(t.path),
        }))
        .sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    }
    const prefix = path ? `${path}/` : '';
    const seen = new Map<string, ExplorerFolder>();
    for (const tag of explorerTags) {
      if (!tag.path.startsWith(prefix)) continue;
      const rest = tag.path.slice(prefix.length);
      if (!rest) continue;
      const name = rest.split('/')[0];
      const fullPath = prefix + name;
      if (!seen.has(fullPath)) {
        seen.set(fullPath, {
          name,
          fullPath,
          tag: tagByPath.get(fullPath),
          count: 0,
          docs: directDocs(fullPath),
          subfolders: directSubfolders(fullPath),
        });
      }
    }
    for (const folder of seen.values()) folder.count = countInside(folder.fullPath);
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();

  const visibleItems = !active
    ? displayed
    : path === ''
      ? displayed.filter((item) => tagIdsOf(item).every((id) => !explorerTags.some((t) => t.id === id)))
      : displayed.filter((item) => {
          const here = tagByPath.get(path);
          return !!here && tagIdsOf(item).includes(here.id);
        });

  // Every folder path the tree has, whether or not a tag sits on it - a
  // folder can be only a segment of a deeper tag's path.
  const allFolderPaths = Array.from(
    new Set(
      explorerTags.flatMap((t) => {
        const parts = t.path.split('/');
        return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
      })
    )
  ).sort();

  // The tag that stands for a folder, made if the folder was only a path
  // segment until now - a record can only be put IN a folder that is a tag.
  async function tagForFolder(folderPath: string): Promise<Tag> {
    const existing = tagByPath.get(folderPath);
    if (existing) return existing;
    const id = await createFolderTag(folderPath, kind, randomColor());
    return { id, path: folderPath, icon: 'folder-outline', color: TAG_COLORS[0], types: [kind], usedIn: {}, keep: true };
  }

  // A folder's path changes, and every path under it follows.
  async function renameFolder(oldPath: string, newPath: string) {
    if (oldPath === newPath || !newPath) return;
    const affected = explorerTags.filter((t) => t.path === oldPath || t.path.startsWith(`${oldPath}/`));
    await Promise.all(affected.map((t) => renameTag(t, newPath + t.path.slice(oldPath.length))));
    if (path === oldPath || path.startsWith(`${oldPath}/`)) {
      setPath(newPath + path.slice(oldPath.length));
    }
  }

  async function saveFolderName(name: string) {
    const prompt = folderPrompt;
    setFolderPrompt(null);
    const clean = cleanName(name);
    if (!prompt || !clean) return;
    if (prompt.mode === 'new') {
      const full = prompt.parent ? `${prompt.parent}/${clean}` : clean;
      if (tagByPath.has(full)) return;
      await createFolderTag(full, kind, randomColor());
    } else {
      const parent = parentOf(prompt.path);
      await renameFolder(prompt.path, parent ? `${parent}/${clean}` : clean);
    }
  }

  // Deleting a folder is unpacking it: what was inside goes up one level -
  // records to the parent folder (or to no folder at the root), and
  // sub-folders lose this one segment of their path.
  async function deleteFolder(folderPath: string) {
    const yes = await confirm({
      title: `Видалити папку «${nameOf(folderPath)}»?`,
      message: 'Те, що в ній, підніметься на рівень вище.',
      confirmLabel: 'Видалити',
    });
    if (!yes) return;
    const parent = parentOf(folderPath);
    const own = tagByPath.get(folderPath);
    if (own) {
      const holders = items.filter((item) => tagIdsOf(item).includes(own.id));
      if (parent) {
        const parentTag = await tagForFolder(parent);
        await Promise.all(holders.map((item) => attachTag(parentTag, kind, item.id, collection)));
      }
      await deleteTagCompletely(own);
    }
    const below = explorerTags.filter((t) => t.path.startsWith(`${folderPath}/`));
    await Promise.all(
      below.map((t) => {
        const rest = t.path.slice(folderPath.length + 1);
        return renameTag(t, parent ? `${parent}/${rest}` : rest);
      })
    );
    if (path === folderPath || path.startsWith(`${folderPath}/`)) setPath(parent);
  }

  // Where a folder or a record could go: the root, and every folder but
  // the one being moved and anything under it.
  async function pickDestination(title: string, exclude?: string): Promise<string | null | 'cancel'> {
    const choice = await ask({
      title,
      actions: [
        { id: '/', label: exclude === undefined ? 'Без папки' : 'Всі (корінь)', icon: 'home-outline' },
        ...allFolderPaths
          .filter((p) => exclude === undefined || (p !== exclude && !p.startsWith(`${exclude}/`)))
          .map((p) => ({ id: `p:${p}`, label: p.split('/').join(' › '), icon: 'folder-outline' as const })),
      ],
    });
    if (choice === 'cancel') return 'cancel';
    if (choice === '/') return null;
    return typeof choice === 'string' && choice.startsWith('p:') ? choice.slice(2) : 'cancel';
  }

  // Moving a record is swapping which folder tag it carries: off every
  // folder it is in now, on to the one chosen.
  async function moveItem(item: T, destination: string | null) {
    const current = explorerTags.filter((t) => tagIdsOf(item).includes(t.id));
    await Promise.all(current.map((t) => detachTag(t, kind, item.id, collection)));
    if (destination === null) return;
    const target = await tagForFolder(destination);
    await attachTag(target, kind, item.id, collection);
  }

  return {
    active,
    path,
    setPath,
    crumbs: path ? path.split('/') : [],
    back,
    forward,
    historyState,
    folders,
    visibleItems,
    folderPrompt,
    setFolderPrompt,
    saveFolderName,
    renameFolder,
    deleteFolder,
    pickDestination,
    moveItem,
    tagForFolder,
    allFolderPaths,
  };
}
