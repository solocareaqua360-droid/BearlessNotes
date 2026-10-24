import { doc, updateDoc } from '../firestore';
import { folderPathFromName } from '../utils/folderName';
import { db } from '../firebase';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Tag, TaggableKind } from '../types';
import { useNavDockFlip, useNavDockPublisher, useWhileFocused } from '../navigation/navDock';
import { TAG_COLORS } from '../constants/tags';
import { ask, confirm } from '../components/surfaces/Ask';
import { FEATURES } from '../features';
import { ALL_FOLDER_KINDS } from '../constants/folderKinds';

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
  createFolderTag: (path: string, kind: TaggableKind, color: string, opts?: { baseOnly?: boolean }) => Promise<string>;
  deleteTagCompletely: (tag: Tag) => Promise<void>;
  renameTag: (tag: Tag, newPath: string) => Promise<void>;
  attachTag: (tag: Tag, kind: TaggableKind, itemId: string, itemsCollection: string) => Promise<void>;
  detachTag: (tag: Tag, kind: TaggableKind, itemId: string, itemsCollection: string) => Promise<void>;
  // The video base calls its folders playlists (2026-10-11): only the words change.
  playlist?: boolean;
  // Folders made here are the base's own COLLECTIONS (Tag.baseOnly): not shown in the explorer until placed there.
  baseOnly?: boolean;
  // What a folder is called here (a collection, a playlist).
};

const cleanName = (name: string) => folderPathFromName(name);
export const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');
export const nameOf = (path: string) => path.split('/').pop() ?? path;
const randomColor = () => TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];

// What the dock's own way-out bead shows while you are inside this
// database's folders: the thing the folders hold.
const DOCK_ICON: Partial<Record<TaggableKind, string>> = {
  document: 'document-text-outline',
  file: 'document-outline',
  photo: 'image-outline',
  link: 'link-outline',
  board: 'easel-outline',
};

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
    playlist,
    baseOnly,
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
  // WHICH FOLDERS THIS EXPLORER SHOWS (the user, 2026-10-10): only those that
  // hold things of THIS kind - drawerTags are exactly the tags something here
  // hangs on - and, through their paths, the folders above them. A folder made
  // right here for this kind alone is kept while it is still empty (otherwise
  // it would vanish the moment it is made). A UNIVERSAL folder (the projects
  // window's, every kind in its `types`) stays out of a database it has
  // nothing in; the general explorer shows every folder, as it shows every file.
  // 2026-10-11: a folder is shown here when this kind is TICKED in its parameters («Де показувати») - a playlist
  // in the video base - except a legacy UNIVERSAL one (every kind), which, as before, needs something of this
  // kind in it. Unticking the kind (or «delete playlist») hides it here and changes nothing in the explorer.
  // A BASE OF COLLECTIONS (photos / YouTube / geo, 2026-10-14): only ITS OWN folders - made here (baseOnly) or holding
  // nothing but this kind - not the explorer's mixed folders that happen to have a photo in them («ці папки ніяк не
  // пов'язані з провідником»). A thing filed only in an explorer folder stands at this base's root.
  // 2026-10-14 night, the user's follow-up: the bases show NO explorer folder at all - only the collections made in the
  // base itself (baseOnly); everything else lies at the base's root («лише папки, а не їх вміст, і лише в інших базах,
  // а не в провіднику»). Nothing is deleted: the explorer keeps every folder and what is in it.
  // 2026-10-15: only THIS base's collections (a photo collection was listed in the geo base too), and a collection
  // placed inside an explorer folder («Подорожі/Італія») still stands at this base's root as «Італія»: the paths here
  // are the base's own, and realPathOf turns one back into the path the tag really has.
  const ownCollections = baseOnly ? tags.filter((t) => t.baseOnly && t.types.includes(kind)) : [];
  const ownPaths = new Set(ownCollections.map((t) => t.path));
  const outerByRoot = new Map<string, string>();
  const realById = new Map(ownCollections.map((t) => [t.id, t]));
  const baseTags = ownCollections.map((t) => {
    const parts = t.path.split('/');
    let outer = '';
    for (let i = 1; i <= parts.length; i++) {
      if (ownPaths.has(parts.slice(0, i).join('/'))) {
        outer = parts.slice(0, i - 1).join('/');
        break;
      }
    }
    const own = outer ? t.path.slice(outer.length + 1) : t.path;
    outerByRoot.set(own.split('/')[0], outer);
    return { ...t, path: own };
  });
  // A path of this base -> the tag's real path. A root that does not exist yet (a rename, a move out of a
  // collection) keeps the outer part of the path it came from.
  function realPathOf(own: string, from?: string): string {
    if (!baseOnly) return own;
    const outer = outerByRoot.get(own.split('/')[0]) ?? (from ? outerByRoot.get(from.split('/')[0]) : undefined) ?? '';
    return outer ? `${outer}/${own}` : own;
  }
  const realTag = (t: Tag): Tag => realById.get(t.id) ?? t;
  const explorerTags = baseOnly
    ? baseTags
    : FEATURES.explorerFoldersByContent
    ? tags.filter((t) => t.types.includes(kind) && (t.types.length < ALL_FOLDER_KINDS.length || drawerTags.some((d) => d.id === t.id)))
    : tags.filter((t) => t.types.includes(kind) || drawerTags.some((d) => d.id === t.id));
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
    // A folder this explorer does not list (it holds nothing of this kind yet)
    // is still THE folder: file into it, never make a twin of the same path.
    if (baseOnly) {
      const id = await createFolderTag(realPathOf(folderPath), kind, randomColor(), { baseOnly: true });
      return { id, path: folderPath, icon: 'folder-outline', color: TAG_COLORS[0], types: [kind], usedIn: {}, keep: true, baseOnly: true };
    }
    const hidden = tags.filter((t) => t.path === folderPath).pop();
    if (hidden) return hidden;
    const id = await createFolderTag(folderPath, kind, randomColor(), baseOnly ? { baseOnly: true } : undefined);
    return { id, path: folderPath, icon: 'folder-outline', color: TAG_COLORS[0], types: [kind], usedIn: {}, keep: true };
  }

  // A folder's path changes, and every path under it follows.
  async function renameFolder(oldPath: string, newPath: string) {
    if (oldPath === newPath || !newPath) return;
    const affected = explorerTags.filter((t) => t.path === oldPath || t.path.startsWith(`${oldPath}/`));
    await Promise.all(affected.map((t) => renameTag(realTag(t), realPathOf(newPath + t.path.slice(oldPath.length), oldPath))));
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
      await createFolderTag(realPathOf(full), kind, randomColor(), baseOnly ? { baseOnly: true } : undefined);
    } else {
      const parent = parentOf(prompt.path);
      await renameFolder(prompt.path, parent ? `${parent}/${clean}` : clean);
    }
  }

  // Deleting a folder is unpacking it: what was inside goes up one level -
  // records to the parent folder (or to no folder at the root), and
  // sub-folders lose this one segment of their path.
  async function deleteFolder(folderPath: string) {
    // A base's OWN collection (baseOnly) is deleted for real; only the old playlists - explorer folders with the video
    // kind ticked - are «deleted» by unticking (2026-10-15: a new playlist was only hidden, under the old wording).
    const oldPlaylist = playlist && !baseOnly;
    const yes = await confirm({
      title: playlist ? `Видалити плейліст «${nameOf(folderPath)}»?` : baseOnly ? `Видалити підбірку «${nameOf(folderPath)}»?` : `Видалити папку «${nameOf(folderPath)}»?`,
      message: oldPlaylist
        ? 'Папка в провіднику й відео в ній лишаться. Плейліст повернеться, якщо знову поставити «YouTube / TikTok» у параметрах папки.'
        : baseOnly
        ? 'Те, що в ній, лишиться в базі.'
        : 'Те, що в ній, підніметься на рівень вище.',
      confirmLabel: 'Видалити',
    });
    if (!yes) return;
    const parent = parentOf(folderPath);
    const own = tagByPath.get(folderPath);
    // A PLAYLIST IS A FOLDER OF THE EXPLORER WITH «video» TICKED (the user, 2026-10-11): deleting the playlist only
    // UNTICKS it - the folder, and every video filed in it, stay in the explorer; ticking it again brings the
    // playlist back.
    if (oldPlaylist && own) {
      await updateDoc(doc(db, 'tags', own.id), { types: (own.types ?? []).filter((k) => k !== kind) }).catch(() => {});
      if (path === folderPath || path.startsWith(`${folderPath}/`)) setPath(parent);
      return;
    }
    if (own) {
      const holders = items.filter((item) => tagIdsOf(item).includes(own.id));
      if (parent) {
        const parentTag = await tagForFolder(parent);
        await Promise.all(holders.map((item) => attachTag(parentTag, kind, item.id, collection)));
      }
      await deleteTagCompletely(realTag(own));
    }
    const below = explorerTags.filter((t) => t.path.startsWith(`${folderPath}/`));
    await Promise.all(
      below.map((t) => {
        const rest = t.path.slice(folderPath.length + 1);
        return renameTag(realTag(t), realPathOf(parent ? `${parent}/${rest}` : rest, folderPath));
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
        { id: '/', label: exclude === undefined ? (playlist ? 'Без плейлиста' : baseOnly ? 'Без підбірки' : 'Без папки') : 'Всі (корінь)', icon: 'home-outline' },
        ...allFolderPaths
          .filter((p) => exclude === undefined || (p !== exclude && !p.startsWith(`${exclude}/`)))
          .map((p) => ({ id: `p:${p}`, label: p.split('/').join(' › '), icon: 'folder-outline' as const })),
      ],
    });
    if (choice === 'cancel') return 'cancel';
    if (choice === '/') return null;
    return typeof choice === 'string' && choice.startsWith('p:') ? choice.slice(2) : 'cancel';
  }

  // Which folder a record is in (the first, if it carries more than one
  // folder tag), or null at the root - what the photos' canvas lays out by.
  function folderOf(item: T): string | null {
    const own = explorerTags.find((t) => tagIdsOf(item).includes(t.id));
    return own ? own.path : null;
  }

  // Every folder a record is in - a folder is a tag, and a record can
  // carry two (the photos' canvas draws it in each).
  function foldersOf(item: T): string[] {
    return explorerTags.filter((t) => tagIdsOf(item).includes(t.id)).map((t) => t.path);
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

  // A record made INSIDE a folder belongs to that folder.
  //
  // Nothing did this: a new note, file or board was created at the root
  // while the user was standing in a folder, so it vanished from the
  // list the moment it appeared - they were in the folder and it was
  // not. A folder is a tag, so joining one is carrying its tag; a folder
  // that was only a segment of a deeper path becomes a real tag here,
  // exactly as it does anywhere else a record is put into one.
  async function assignToCurrentFolder(itemId: string) {
    if (!active || path === '') return;
    const folder = await tagForFolder(path);
    await attachTag(folder, kind, itemId, collection);
  }

  // The dock is told where we are - see src/navigation/navDock.tsx and
  // «план навігації» in the project memory. Inside folders it stops being
  // the switch between desks and becomes the path itself; at the root it
  // goes back to being the dock, which is what makes leaving the folders
  // and leaving the context one and the same move.
  //
  // Only the FOCUSED screen speaks. Several explorers stay mounted at
  // once (a tab navigator keeps its screens alive, and a pane holds
  // another), and two of them publishing would leave the dock showing
  // whichever rendered last rather than the one being looked at.
  const crumbs = path ? path.split('/') : [];
  const publishToDock = useNavDockPublisher();
  // Asked, not subscribed to: useIsFocused here redrew the whole list it
  // serves on every note opened and closed (2026-10-06, the phone's log:
  // the documents list, 40-50 ms, before the note could even start).
  const navigation = useNavigation();
  const crumbKey = path;
  const goToCrumb = useCallback((target: string) => setPath(target), []);
  // STEPPING INTO A FOLDER TURNS THE DOCK to what can be done in it -
  // drawn as a swipe, not as a swap (see ContextDock's `flip`): "панель
  // повинна прогортатись на вкладку функцій так як ніби я її прогорнув
  // пальцем". Only on the way DOWN: walking back out to the root takes
  // the path away with it, and there is nothing left to have turned.
  const flipDock = useNavDockFlip();
  const lastDepthRef = useRef(path === '' ? 0 : path.split('/').length);
  useEffect(() => {
    const depth = path === '' ? 0 : path.split('/').length;
    const wasDeeper = depth > lastDepthRef.current;
    lastDepthRef.current = depth;
    if (!navigation.isFocused() || !active || !wasDeeper) return;
    flipDock('actions');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, active, flipDock]);
  useWhileFocused(() => {
    if (!publishToDock) return;
    if (!active || crumbKey === '') return;
    publishToDock({ kind: 'path', icon: DOCK_ICON[kind] ?? 'folder-outline', crumbs: crumbKey.split('/'), onGo: goToCrumb });
    return () => publishToDock(null);
  }, [publishToDock, active, crumbKey, goToCrumb]);

  return {
    active,
    path,
    setPath,
    crumbs,
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
    folderOf,
    foldersOf,
    tagForFolder,
    assignToCurrentFolder,
    allFolderPaths,
    baseOnly: !!baseOnly,
    realPathOf,
    // This base's collections with their REAL paths - what the recent strip offers (it shows only the last name).
    ownCollections,
    // The same with the paths of THIS base (a placed «розробка/концепти/tstpidb» is «tstpidb» here) - for the picker,
    // with its rename going back to the real path.
    collectionTags: baseTags,
    renameCollection: (t: Tag, own: string) => renameTag(realTag(t), realPathOf(own, t.path)),
  };
}
