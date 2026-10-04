// THE LIBRARY (app-only, not part of the drawing file): folders, which
// drawing sits in which, the bin, and how the list is shown. Folders nest:
// a folder is a path, "робота/ескізи" is «ескізи» inside «робота». A drawing
// sits in ONE folder or none (the user's call - no tags here). A folder
// lives while something is in it, or while it is kept (made on purpose).
export type SortKey = 'title' | 'created' | 'updated';
export type Sort = { key: SortKey; dir: 'asc' | 'desc' };
export type FolderEntry = { path: string; color: string };
export type Library = {
  v: 2;
  folders: FolderEntry[]; // kept folders, with their colour
  assign: Record<string, string>; // drawing id -> folder path
  trash: Record<string, number>; // drawing id -> when it went to the bin
  sort: Sort;
  view: 'grid' | 'list';
  recent: string[]; // folders used last, newest first
};

export const FOLDER_COLORS = ['#D9793F', '#4F9BFF', '#5DB86A', '#E0524A', '#A77BE0', '#E2A93B', '#3FB8C0', '#8E8E93'];

export const emptyLibrary = (): Library => ({
  v: 2,
  folders: [],
  assign: {},
  trash: {},
  sort: { key: 'updated', dir: 'desc' },
  view: 'grid',
  recent: [],
});

export const parentOf = (p: string): string | null => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null);
export const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const join = (parent: string | null, name: string) => (parent ? `${parent}/${name}` : name);
export const within = (p: string, base: string) => p === base || p.startsWith(`${base}/`);
// A name as a folder can carry it: no slashes (they are the nesting), no
// doubled or edge spaces.
export const cleanName = (s: string) => s.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
export const compareTitles = (a: string, b: string) => a.localeCompare(b, 'uk', { sensitivity: 'base', numeric: true });
export const showPath = (p: string) => p.split('/').join(' / ');

// Every folder there is: the kept ones, the ones drawings sit in, and every
// folder above them.
export function allPaths(lib: Library): string[] {
  const set = new Set<string>();
  const add = (p: string) => {
    for (let q: string | null = p; q; q = parentOf(q)) set.add(q);
  };
  lib.folders.forEach((f) => add(f.path));
  for (const [id, p] of Object.entries(lib.assign)) if (!(id in lib.trash)) add(p);
  return [...set].sort(compareTitles);
}

export const childFolders = (lib: Library, parent: string | null) =>
  allPaths(lib).filter((p) => parentOf(p) === parent).sort((a, b) => compareTitles(nameOf(a), nameOf(b)));

export function colorOf(lib: Library, path: string): string {
  const own = lib.folders.find((f) => f.path === path);
  if (own) return own.color;
  let h = 0;
  for (const ch of path) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FOLDER_COLORS[h % FOLDER_COLORS.length];
}

// A path, or anything inside it, moved under a new name.
const remap = (p: string, from: string, to: string) => (within(p, from) ? to + p.slice(from.length) : p);

function remapAll(lib: Library, from: string, to: string): Library {
  const folders: FolderEntry[] = [];
  for (const f of lib.folders) {
    const path = remap(f.path, from, to);
    if (!folders.some((x) => x.path === path)) folders.push({ ...f, path });
  }
  const assign: Record<string, string> = {};
  for (const [id, p] of Object.entries(lib.assign)) assign[id] = remap(p, from, to);
  const recent = [...new Set(lib.recent.map((p) => remap(p, from, to)))];
  return { ...lib, folders, assign, recent };
}

export function addFolder(lib: Library, parent: string | null, rawName: string): Library {
  const name = cleanName(rawName);
  if (!name) return lib;
  const path = join(parent, name);
  if (allPaths(lib).includes(path)) return lib;
  const color = FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)];
  return { ...lib, folders: [...lib.folders, { path, color }] };
}

// The whole branch follows: everything inside the folder keeps its place in it.
export function renameFolder(lib: Library, path: string, rawName: string): Library {
  const name = cleanName(rawName);
  if (!name) return lib;
  return remapAll(lib, path, join(parentOf(path), name));
}

export function moveFolder(lib: Library, path: string, newParent: string | null): Library {
  if (newParent && within(newParent, path)) return lib;
  return remapAll(lib, path, join(newParent, nameOf(path)));
}

// What was in it goes one level up: drawings to the parent folder,
// subfolders lose this one step of their path.
export function deleteFolder(lib: Library, path: string): Library {
  const parent = parentOf(path);
  const lift = (p: string) => (p === path ? parent : within(p, path) ? join(parent, p.slice(path.length + 1)) : p);
  const assign: Record<string, string> = {};
  for (const [id, p] of Object.entries(lib.assign)) {
    const next = lift(p);
    if (next) assign[id] = next;
  }
  const folders: FolderEntry[] = [];
  for (const f of lib.folders) {
    const next = lift(f.path);
    if (next && !folders.some((x) => x.path === next)) folders.push({ ...f, path: next });
  }
  const recent = lib.recent.map(lift).filter((p): p is string => !!p);
  return { ...lib, folders, assign, recent: [...new Set(recent)] };
}

export function moveDrawings(lib: Library, ids: string[], path: string | null): Library {
  const assign = { ...lib.assign };
  for (const id of ids) {
    if (path) assign[id] = path;
    else delete assign[id];
  }
  const recent = path ? [path, ...lib.recent.filter((p) => p !== path)].slice(0, 8) : lib.recent;
  return { ...lib, assign, recent };
}
