import type { Tag, TaggableKind } from '../types';
import type { CanvasPhoto, Move } from '../components/FolderCanvas';

// What FolderCanvas asks a database to do with its folders, the same for
// every database: the folder is a tag (a smart folder), and these move
// records between tags. The target's tag is made ONCE per batch - looked up
// per record, a folder that is only a path segment would get a tag per
// record before the tag list caught up.
type Explorer = {
  tagForFolder: (path: string) => Promise<Tag>;
  renameFolder: (oldPath: string, newPath: string) => Promise<void>;
};
type TagOps = {
  attachTag: (tag: Tag, kind: TaggableKind, itemId: string, collection: string) => Promise<void>;
  detachTag: (tag: Tag, kind: TaggableKind, itemId: string, collection: string) => Promise<void>;
};

const nameOf = (path: string) => path.split('/').pop() ?? path;

export function canvasFolderActions(explorer: Explorer, tags: TagOps, kind: TaggableKind, collection: string) {
  const takeOut = async (item: CanvasPhoto, from: string | null) => {
    if (from) await tags.detachTag(await explorer.tagForFolder(from), kind, item.id, collection);
  };
  return {
    // Out of the folder each was carried FROM, into `to` - other folders
    // untouched (a record can carry two folder tags).
    onRelocate: async (moves: Move[], to: string | null) => {
      const target = to ? await explorer.tagForFolder(to) : null;
      for (const { photo, from } of moves) {
        await takeOut(photo, from);
        if (target) await tags.attachTag(target, kind, photo.id, collection);
      }
    },
    onAdd: async (items: CanvasPhoto[], to: string) => {
      const target = await explorer.tagForFolder(to);
      for (const item of items) await tags.attachTag(target, kind, item.id, collection);
    },
    onCreateFolder: async (name: string, moves: Move[]) => {
      const target = await explorer.tagForFolder(name);
      for (const { photo, from } of moves) {
        await takeOut(photo, from);
        await tags.attachTag(target, kind, photo.id, collection);
      }
    },
    onMoveFolder: (path: string, parent: string | null) =>
      explorer.renameFolder(path, parent ? `${parent}/${nameOf(path)}` : nameOf(path)),
  };
}
