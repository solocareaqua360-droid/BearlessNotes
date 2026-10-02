import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import FolderCanvas, { CANVAS_TILE, type CanvasPhoto, type Move } from './FolderCanvas';
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
const randomColor = () => TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];

export default function FoldersCanvas({ topPad }: { topPad: number }) {
  const S = useSoft();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { tags, attachTag, detachTag, createFolderTag, renameTag } = useTags();
  const items = useAllFolderItems(tags);
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
