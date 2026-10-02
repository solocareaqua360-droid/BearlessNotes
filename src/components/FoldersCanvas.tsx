import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import FolderCanvas, { CANVAS_TILE, type CanvasPhoto, type Move } from './FolderCanvas';
import FolderBaseLinks, { type BaseLink, type LinkBase } from './FolderBaseLinks';
import { useDatabaseTiles } from '../hooks/useDatabaseTiles';
import { TAG_KIND_CHOICES } from '../constants/tagKinds';
import { GRID_TILES, WIDE_TILES } from '../constants/databaseTiles';
import { useRecordColour } from '../theme/ThemeProvider';
import { ask } from './surfaces/Ask';
import { FileCanvasTile, LinkCanvasTile, NoteCanvasTile } from './CanvasTiles';
import AttachmentImage from './AttachmentImage';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { useTags } from '../hooks/useTags';
import { useAllFolderItems, type FolderItem } from '../hooks/useAllFolderItems';
import { LINK_CATEGORY_INFO } from '../utils/linkCategory';
import { TAG_COLORS } from '../constants/tags';
import type { RootStackParamList } from '../navigation';
import type { Tag } from '../types';

// THE FOLDERS AS ONE TABLE (the folders rework, step 1, 2026-10-02). The
// same canvas each database has («Полотно», FolderCanvas) - islands for
// folders, nested ones inside, piles - but holding what is in the folders
// from EVERY database at once: photos beside files beside notes beside
// links, each tile with a small badge saying what it is. Carrying a tile
// into another island moves it there in its own database; carrying an
// island moves the folder. Only what is in some folder is on it.

const KIND_ICON: Record<FolderItem['kind'], string> = {
  document: 'document-text-outline',
  photo: 'image-outline',
  file: 'document-outline',
  link: 'link-outline',
  flashcard: 'albums-outline',
  board: 'easel-outline',
  row: 'grid-outline',
};

const nameOf = (path: string) => path.split('/').pop() ?? path;

// Which tile on the Бази board each folder kind is - the circles of
// FolderBaseLinks wear that tile's own icon and colour.
const TILE_OF_KIND: Record<string, string> = {
  document: 'documents',
  photo: 'photos',
  file: 'files',
  'link-other': 'links',
  'link-video': 'video',
  'link-geo': 'geo',
  board: 'board',
  flashcard: 'flashcards',
};
const TILES = [...WIDE_TILES, ...GRID_TILES];
const randomColor = () => TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];

export default function FoldersCanvas({
  topPad,
  linksOpen,
  resetFolders,
}: {
  topPad: number;
  linksOpen: boolean;
  resetFolders?: number;
}) {
  const S = useSoft();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { tags, attachTag, detachTag, createFolderTag, renameTag, updateTag } = useTags();
  const items = useAllFolderItems(tags);
  const { customDatabases, colorFor, iconFor } = useDatabaseTiles();
  const recordColour = useRecordColour();
  // The databases, as circles - in the icons and colours of their own
  // tiles on the Бази board: the built-in ones, then the user's own.
  const bases: LinkBase[] = [
    ...TAG_KIND_CHOICES.map((c) => {
      const tileKey = TILE_OF_KIND[c.kind];
      const tile = TILES.find((t) => t.key === tileKey);
      return {
        kind: c.kind,
        label: c.label,
        icon: tile ? iconFor(tile.key, tile.icon) : 'grid-outline',
        color: tileKey ? colorFor(tileKey) : S.ink2,
      };
    }),
    ...customDatabases.map((d) => ({
      kind: `customRow:${d.id}`,
      label: d.name || 'База',
      icon: d.icon ?? 'grid-outline',
      color: d.color ?? recordColour(d.id).background,
    })),
  ];
  const baseLabel = (kind: string) => bases.find((b) => b.kind === kind)?.label ?? 'База';
  // A line for every database a folder shows in; how much of it is inside
  // decides solid or dashed.
  const links: BaseLink[] = tags.flatMap((tag) =>
    tag.types
      .filter((kind) => bases.some((b) => b.kind === kind))
      .map((kind) => ({
        kind,
        path: tag.path,
        count: Object.keys(tag.usedIn).filter((key) => key.startsWith(`${kind}:`)).length,
      }))
  );
  const withTypes = (tag: Tag, types: string[]) =>
    updateTag(tag, { path: tag.path, icon: tag.icon, color: tag.color, types }).catch(() => {});
  const bind = async (kind: string, path: string) => {
    const tag = byPath.get(path);
    if (tag) {
      if (!tag.types.includes(kind)) await withTypes(tag, [...tag.types, kind]);
    } else {
      await createFolderTag(path, kind, randomColor());
    }
  };
  // Never hides what is inside: a dashed line just goes; a solid one asks
  // where its contents go - out of the folder, or into another one.
  const unbind = async (link: BaseLink) => {
    const tag = byPath.get(link.path);
    if (!tag) return;
    const dropType = () => withTypes(tag, tag.types.filter((k) => k !== link.kind));
    if (link.count === 0) {
      await dropType();
      return;
    }
    const inside = items.filter((item) => item.tagKind === link.kind && item.tagIds.includes(tag.id));
    const choice = await ask({
      title: `«${nameOf(link.path)}» · ${baseLabel(link.kind)}`,
      message: `У папці ${link.count} з цієї бази. Вони нікуди не зникнуть - вибери, куди їх.`,
      actions: [
        { id: 'out', label: `Вийняти з папки (${link.count})`, icon: 'remove-circle-outline' },
        { id: 'move', label: 'Перенести в іншу папку…', icon: 'folder-open-outline' },
      ],
    });
    if (choice === 'out') {
      for (const item of inside) await detachTag(tag, item.tagKind, item.docId, item.collection);
      await dropType();
    } else if (choice === 'move') {
      const target = await ask({
        title: 'Куди перенести?',
        actions: folderPaths
          .filter((p) => p !== link.path)
          .map((p) => ({ id: p, label: p.split('/').join(' › '), icon: 'folder-outline' as const })),
      });
      if (!target || target === 'cancel' || !folderPaths.includes(target)) return;
      for (const item of inside) {
        await detachTag(tag, item.tagKind, item.docId, item.collection);
        await putIn(item, target);
      }
      await dropType();
    }
  };
  const byPath = new Map(tags.map((t) => [t.path, t]));
  const folderPaths = Array.from(
    new Set(
      tags.flatMap((t) => {
        const parts = t.path.split('/');
        return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
      })
    )
  ).sort();
  const asItem = (c: CanvasPhoto) => c as FolderItem;

  // The tag that stands for a folder - made, under the kind of what is
  // going into it, if the folder was only a path segment until now.
  const tagFor = async (path: string, kind: string): Promise<Tag> => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const color = randomColor();
    const id = await createFolderTag(path, kind, color);
    const made: Tag = { id, path, icon: 'folder-outline', color, types: [kind], usedIn: {}, keep: true };
    byPath.set(path, made);
    return made;
  };
  const takeOut = async (item: FolderItem, from: string | null) => {
    const tag = from ? byPath.get(from) : null;
    if (tag) await detachTag(tag, item.tagKind, item.docId, item.collection);
  };
  const putIn = async (item: FolderItem, to: string) => {
    await attachTag(await tagFor(to, item.tagKind), item.tagKind, item.docId, item.collection);
  };

  const open = (c: CanvasPhoto) => {
    const item = asItem(c);
    switch (item.kind) {
      case 'document':
        navigation.navigate('Editor', { documentId: item.docId });
        return;
      case 'row':
        if (item.databaseId) {
          (navigation as unknown as { navigate: (name: string, params?: object) => void }).navigate('CustomDatabase', {
            databaseId: item.databaseId,
            openRowId: item.docId,
          });
        }
        return;
      case 'board':
        (navigation as unknown as { navigate: (name: string, params?: object) => void }).navigate('Board', { boardId: item.docId });
        return;
      case 'photo':
        navigation.navigate('Photos');
        return;
      case 'file':
        navigation.navigate('Files');
        return;
      case 'link':
        navigation.navigate('Links', { category: item.linkCategory ?? 'other' });
        return;
      case 'flashcard':
        navigation.navigate('Flashcards');
        return;
    }
  };

  const face = (item: FolderItem) => {
    switch (item.kind) {
      case 'photo':
        return <AttachmentImage uri={item.imageUri ?? ''} driveFileId={item.driveFileId} style={styles.photo} />;
      case 'file':
        return <FileCanvasTile name={item.fileName || item.title} />;
      case 'link':
        return (
          <LinkCanvasTile
            title={item.title}
            imageUrl={item.imageUrl}
            icon={LINK_CATEGORY_INFO[item.linkCategory ?? 'other'].icon}
          />
        );
      case 'document':
        return <NoteCanvasTile title={item.title} blocks={item.blocks} />;
      default:
        return <NoteCanvasTile title={item.title} />;
    }
  };

  return (
    <FolderCanvas
      layoutKey="foldersCanvas"
      renderTile={(c) => {
        const item = asItem(c);
        return (
          <View>
            {face(item)}
            {/* What it is, in the corner - a photo beside a note beside a
                file is the whole point of this table. */}
            <View style={[styles.badge, { backgroundColor: S.card, boxShadow: S.shadow }]} pointerEvents="none">
              <Ionicons name={KIND_ICON[item.kind] as never} size={11} color={S.ink2} />
            </View>
          </View>
        );
      }}
      titleOf={(c) => asItem(c).title}
      photos={items}
      folderPaths={folderPaths}
      foldersOf={(c) => tags.filter((t) => asItem(c).tagIds.includes(t.id)).map((t) => t.path)}
      onRelocate={async (moves: Move[], to: string | null) => {
        for (const { photo, from } of moves) {
          const item = asItem(photo);
          await takeOut(item, from);
          if (to) await putIn(item, to);
        }
      }}
      onAdd={async (added: CanvasPhoto[], to: string) => {
        for (const c of added) await putIn(asItem(c), to);
      }}
      onCreateFolder={async (name: string, moves: Move[]) => {
        for (const { photo, from } of moves) {
          const item = asItem(photo);
          await takeOut(item, from);
          await putIn(item, name);
        }
      }}
      onMoveFolder={async (path: string, parent: string | null) => {
        const next = parent ? `${parent}/${nameOf(path)}` : nameOf(path);
        if (next === path) return;
        const affected = tags.filter((t) => t.path === path || t.path.startsWith(`${path}/`));
        await Promise.all(affected.map((t) => renameTag(t, next + t.path.slice(path.length))));
      }}
      onOpenPhoto={open}
      onPhotoMenu={open}
      topPad={topPad}
      resetFolders={resetFolders}
      overlay={(api) => (
        <FolderBaseLinks
          open={linksOpen}
          topLimit={topPad}
          api={api}
          bases={bases}
          links={links}
          onBind={bind}
          onUnbind={unbind}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  photo: {
    width: CANVAS_TILE,
    height: CANVAS_TILE,
  },
  badge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
