import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  updateDoc,
  writeBatch,
} from '../firestore';
import { addDoc, ownedQuery, setDoc } from '../utils/owned';
import { db } from '../firebase';
import { BoardsStackParamList } from '../navigation';
import { BoardCard, BoardColumn, BoardItem } from '../types';
import { readBoardPart } from '../utils/boardStorage';
import { colorForDocument } from '../utils/documentColor';
import BoardMiniMap from '../components/BoardMiniMap';
import DatabaseChrome from '../components/DatabaseChrome';
import GroupPickerSheet from '../components/GroupPickerSheet';
import TagPicker from '../components/TagPicker';
import GroupSections from '../components/GroupSections';
import { useDatabaseList } from '../hooks/useDatabaseList';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { useExplorer, ExplorerFolder, nameOf } from '../hooks/useExplorer';
import ExplorerHead from '../components/ExplorerHead';
import RenamePrompt from '../components/RenamePrompt';
import { MAX_CONTENT_WIDTH } from '../components/ContentColumn';
import { GLASS_BODY, GLASS_TEXT } from '../constants/glass';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { BlurView } from 'expo-blur';
import { GlassPortal } from '../components/GlassPortal';
import { useBlurTarget } from '../components/GlassTarget';
import { GLASS_ISLAND } from '../constants/glass';
import { RAIL_CLEARANCE } from '../constants/rail';
import { ask, confirm } from '../components/surfaces/Ask';

const ACCENT = '#8B5CF6';
// The "+" fill: the accent at half strength, since the blur behind it is
// what separates it from the screen (see DatabaseChrome).
const ACCENT_GLASS = 'rgba(139,92,246,0.5)';
const boardsCollection = collection(db, 'boards');

// List of "Дошка" boards. It WAS deliberately minimal next to Files,
// Links and Photos - no tags, groups, sort or bulk-select, on the
// reasoning that a handful of boards needs none of it. The user's call is
// that boards are a database like the others, so it wears the same chrome
// they do: search, sorting, choosing with bulk actions, tags, groups, the
// drawer on a swipe, and the same rail.
export default function BoardsListScreen({
  inPane,
  standalone,
}: { inPane?: boolean; standalone?: boolean } = {}) {
  const navigation = useNavigation<NativeStackNavigationProp<BoardsStackParamList>>();
  const { width: windowWidth } = useWindowDimensions();
  // Two across where there is room for two. A board's row is a name and a
  // count beside a small map - at the width of the Fold's inner screen one
  // of them per line is a very long way to say very little.
  const responsive = useResponsiveLayout();
  const { width: layoutWidth, height: layoutHeight } = responsive;
  const isTwoPane = responsive.isTwoPane && !inPane;
  const [boards, setBoards] = useState<BoardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Rows or tiles. The mini-map in a row is 48px - enough to tell two
  // boards apart, not enough to see what's on one - so the tile view
  // exists to give it room.
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');
  useEffect(() => {
    return onSnapshot(doc(db, 'settings', 'boardsPrefs'), (snapshot) => {
      const mode = snapshot.data()?.viewMode;
      if (mode === 'list' || mode === 'cards') setViewMode(mode);
    });
  }, []);
  async function changeViewMode(mode: 'list' | 'cards') {
    setViewMode(mode);
    await setDoc(doc(db, 'settings', 'boardsPrefs'), { viewMode: mode }, { merge: true });
  }
  const [renamingBoard, setRenamingBoard] = useState<BoardItem | null>(null);
  const [tagPickerBoardId, setTagPickerBoardId] = useState<string | null>(null);
  const [bulkTagPickerVisible, setBulkTagPickerVisible] = useState(false);
  const [bulkGroupPickerVisible, setBulkGroupPickerVisible] = useState(false);

  // The machine every database shares - see useDatabaseList. Boards were
  // "deliberately minimal next to Files/Links/Photos" for a long time; the
  // user's call is that they should be one of them.
  const list = useDatabaseList<BoardItem>({
    prefsKey: 'boardsPrefs',
    groupKind: 'board',
    tagKind: 'board',
    items: boards,
    tagIdsOf: (b) => b.tagIds ?? [],
    groupIdOf: (b) => b.groupId,
    titleOf: (b) => b.title,
    createdAtOf: (b) => b.createdAt,
    updatedAtOf: (b) => b.updatedAt,
  });
  const {
    displayed: displayedBoards,
    groups,
    tags,
    attachTag,
    detachTag,
    createAndAttachTag,
    renameTag,
    isSelectMode,
    selectedIds,
    toggle: toggleSelected,
    clear: clearSelection,
    requestDeleteMany,
    selected: selectedBoards,
    needle,
  } = list;

  async function bulkAttachTag(tag: Parameters<typeof attachTag>[0]) {
    setBulkTagPickerVisible(false);
    await Promise.all(selectedBoards.map((b) => attachTag(tag, 'board', b.id, 'boards')));
    clearSelection();
  }

  async function bulkCreateAndAttachTag(path: string, icon: string, color: string) {
    setBulkTagPickerVisible(false);
    await Promise.all(selectedBoards.map((b) => createAndAttachTag(path, icon, color, 'board', b.id, 'boards')));
    clearSelection();
  }

  async function bulkAssignGroup(groupId: string | null) {
    setBulkGroupPickerVisible(false);
    const batch = writeBatch(db);
    selectedBoards.forEach((b) => {
      batch.update(doc(db, 'boards', b.id), { groupId: groupId ?? deleteField() });
    });
    await batch.commit();
    clearSelection();
  }

  // Folders, and the path through them. A folder is a segment of a tag's
  // path, so boards get the explorer for free now that they carry tags -
  // see useExplorer, which is this machinery lifted out of the documents
  // screen so the two cannot drift apart.
  const explorer = useExplorer<BoardItem>({
    kind: 'board',
    collection: 'boards',
    items: boards,
    displayed: displayedBoards,
    tagIdsOf: (b) => b.tagIds ?? [],
    tags: list.tags,
    drawerTags: list.drawerTags,
    explorerMode: list.explorerMode,
    searching: needle !== '',
    needle,
    createFolderTag: list.createFolderTag,
    deleteTagCompletely: list.deleteTagCompletely,
    renameTag: list.renameTag,
    attachTag: list.attachTag,
    detachTag: list.detachTag,
  });

  // What a held folder can do, the same three things it can do in the
  // documents explorer.
  function openFolderMenu(folder: ExplorerFolder) {
    ask({
      title: nameOf(folder.fullPath),
      actions: [
        { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' },
        { id: 'move', label: 'Перемістити', icon: 'arrow-forward-outline' },
        { id: 'delete', label: 'Видалити', icon: 'trash-outline', tone: 'danger' },
      ],
    }).then(async (answer) => {
      if (answer === 'rename') explorer.setFolderPrompt({ mode: 'rename', path: folder.fullPath });
      if (answer === 'delete') explorer.deleteFolder(folder.fullPath);
      if (answer === 'move') {
        const destination = await explorer.pickDestination('Куди перемістити папку?', folder.fullPath);
        if (destination === 'cancel') return;
        const name = nameOf(folder.fullPath);
        await explorer.renameFolder(folder.fullPath, destination ? `${destination}/${name}` : name);
      }
    });
  }

  const tagPickerBoard = tagPickerBoardId ? boards.find((b) => b.id === tagPickerBoardId) ?? null : null;

  // In explorer mode the list is what is IN this folder; in the other two
  // it is everything the filters left.
  const boardsHere = explorer.visibleItems;

  function confirmDeleteSelected() {
    const toDelete = selectedBoards;
    requestDeleteMany(toDelete, `Видалено дощок: ${toDelete.length}`, () => {
      toDelete.forEach((b) => deleteDoc(doc(db, 'boards', b.id)));
    });
    clearSelection();
  }

  useEffect(() => {
    return onSnapshot(
      ownedQuery('boards'),
      (snapshot) => {
      setBoards(
        snapshot.docs
          .map((docSnapshot) => {
            const data = docSnapshot.data();
            return {
              id: docSnapshot.id,
              title: data.title ?? 'Без назви',
              // Through readBoardPart, not raw. A board's cards are an
              // array on older boards and a map on newer ones, and this
              // handed whichever it found straight to BoardMiniMap, which
              // calls .filter on it. A map there crashed the whole list -
              // and it also meant a keyed board drew no mini-map at all,
              // because an object has no .length to pass the check below.
              cards: readBoardPart<BoardCard>(data.cards),
              columns: readBoardPart<BoardColumn>(data.columns),
              tagIds: data.tagIds ?? [],
              groupId: data.groupId,
              trashed: data.trashed === true,
              createdAt: data.createdAt ?? 0,
              updatedAt: data.updatedAt ?? 0,
            };
          })
          // A board in the bin is not in the list. The bin itself is the
          // next slice of this work.
          .filter((board) => !board.trashed)
          .sort((a, b) => b.updatedAt - a.updatedAt)
      );
        setIsLoading(false);
      },
      // A listener that fails must say so. Without this handler the error
      // went nowhere and the screen kept its spinner for ever, which is
      // indistinguishable from a slow network and tells no one anything -
      // exactly how the single-tab cache problem presented itself.
      (error) => {
        setLoadError(error.message);
        setIsLoading(false);
      }
    );
  }, []);


  // Same rule as a database's card grid: a tile stays near 300dp and the
  // grid takes as many columns as fit - two on a phone, more on a wide
  // screen. The content column caps the width it divides.
  // 20 of padding on the left and the rail's clearance on the right -
  // the tile width is an exact number of pixels, so it has to be worked
  // out from the SAME margins the grid actually uses, or the last column
  // ends up under the buttons.
  const gridWidth = Math.min(windowWidth, MAX_CONTENT_WIDTH) - 20 - RAIL_CLEARANCE;
  const tileColumns = Math.max(2, Math.min(4, Math.floor(gridWidth / 300)));
  const tileWidth = Math.floor((gridWidth - 12 * (tileColumns - 1)) / tileColumns);

  async function createBoard() {
    const now = Date.now();
    const ref = await addDoc(boardsCollection, { title: 'Без назви', cards: [], createdAt: now, updatedAt: now });
    navigation.navigate('Board', { boardId: ref.id });
  }

  function openBoard(board: BoardItem) {
    navigation.navigate('Board', { boardId: board.id });
  }

  async function renameBoard(board: BoardItem, title: string) {
    setRenamingBoard(null);
    await updateDoc(doc(db, 'boards', board.id), { title });
  }

  // What to do with one board, asked by its own name - the sheet this
  // replaces was a white slab against the bottom edge, in nothing like
  // the app's own colours.
  function askBoardActions(board: BoardItem) {
    ask({
      title: board.title || 'Без назви',
      actions: [
        { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' },
        { id: 'tags', label: 'Теги', icon: 'pricetag-outline' },
        // Only where there are folders to move it BETWEEN.
        ...(explorer.active
          ? [{ id: 'move', label: 'Перемістити', icon: 'arrow-forward-outline' as const }]
          : []),
        { id: 'delete', label: 'Видалити', icon: 'trash-outline', tone: 'danger' },
      ],
    }).then(async (answer) => {
      if (answer === 'rename') setRenamingBoard(board);
      if (answer === 'tags') setTagPickerBoardId(board.id);
      if (answer === 'delete') confirmDeleteBoard(board);
      if (answer === 'move') {
        const destination = await explorer.pickDestination('Куди перемістити дошку?');
        if (destination === 'cancel') return;
        await explorer.moveItem(board, destination);
      }
    });
  }

  function confirmDeleteBoard(board: BoardItem) {
    confirm({
      title: 'Видалити дошку?',
      message: board.title || 'Без назви',
      confirmLabel: 'Видалити',
    }).then((yes) => {
      if (!yes) return;
      deleteDoc(doc(db, 'boards', board.id));
    });
  }

  function renderBoardRow(item: BoardItem) {
    const { background, text, textMuted } = colorForDocument(item.id);
    return (
      <Pressable
        key={item.id}
        style={[styles.row, isTwoPane && styles.rowHalf, { backgroundColor: background }]}
        onPress={() => openBoard(item)}
        onLongPress={() => askBoardActions(item)}
      >
        {/* The board's own layout in miniature, drawn from its cards -
            always current, because it is the cards. Falls back to the
            plain icon while there is nothing on the canvas to draw. */}
        <View style={styles.rowIcon}>
          {item.cards.length > 0 || (item.columns?.length ?? 0) > 0 ? (
            <BoardMiniMap cards={item.cards} columns={item.columns} width={48} height={48} />
          ) : (
            <Ionicons name="apps-outline" size={20} color={text} />
          )}
        </View>
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2}>
            {item.title || 'Без назви'}
          </Text>
          <Text style={[styles.rowMeta, { color: textMuted }]}>
            {item.cards.length} {item.cards.length === 1 ? 'картка' : 'карток'}
          </Text>
        </View>
        <Pressable hitSlop={8} onPress={() => askBoardActions(item)} style={styles.rowActionButton}>
          <Ionicons name="ellipsis-horizontal" size={16} color={textMuted} />
        </Pressable>
      </Pressable>
    );
  }

  // A board as a tile: its own miniature at a size where the cards are
  // cards, with the name under it.
  function renderBoardTile(item: BoardItem, tileWidth: number) {
    const { background, text, textMuted } = colorForDocument(item.id);
    const mapHeight = Math.round(tileWidth * 0.72);
    return (
      <Pressable
        key={item.id}
        style={[styles.tile, { width: tileWidth, backgroundColor: background }]}
        onPress={() => openBoard(item)}
        onLongPress={() => askBoardActions(item)}
      >
        <View style={[styles.tileMap, { height: mapHeight }]}>
          {item.cards.length > 0 || (item.columns?.length ?? 0) > 0 ? (
            <BoardMiniMap cards={item.cards} columns={item.columns} width={tileWidth} height={mapHeight} showText />
          ) : (
            <View style={styles.tileEmpty}>
              <Ionicons name="apps-outline" size={24} color={textMuted} />
            </View>
          )}
        </View>
        <View style={styles.tileBody}>
          <Text style={[styles.rowTitle, { color: text }]} numberOfLines={1}>
            {item.title || 'Без назви'}
          </Text>
          <Text style={[styles.rowMeta, { color: textMuted }]}>
            {item.cards.length} {item.cards.length === 1 ? 'картка' : 'карток'}
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <DatabaseChrome<BoardItem>
      list={list}
      accent={ACCENT}
      accentGlass={ACCENT_GLASS}
      // A tab's own root has nowhere to go back to and the island at its
      // foot; a COPY pushed over the tile board has a way back and no
      // island, like every other pushed screen.
      hasIsland={!standalone}
      onBack={standalone ? () => navigation.goBack() : undefined}
      searchPlaceholder="Пошук дощок"
      onAdd={createBoard}
      addIcon="easel-outline"
      explorer={{
        mode: list.listMode,
        onChangeMode: list.setListMode,
        active: explorer.active,
        onNewFolder: () => explorer.setFolderPrompt({ mode: 'new', parent: explorer.path }),
        onBack: explorer.back,
        onForward: explorer.forward,
        canBack: explorer.historyState.canBack,
        canForward: explorer.historyState.canForward,
      }}
      shape={{
        icon: viewMode === 'cards' ? 'grid-outline' : 'reorder-four-outline',
        onToggle: () => changeViewMode(viewMode === 'list' ? 'cards' : 'list'),
      }}
      bulk={{
        onTag: () => setBulkTagPickerVisible(true),
        onGroup: () => setBulkGroupPickerVisible(true),
        onDelete: confirmDeleteSelected,
      }}
      overlay={
        <>
          <TagPicker
            visible={tagPickerBoardId !== null}
            kind="board"
            tags={tags}
            selectedTagIds={tagPickerBoard?.tagIds ?? []}
            onAttach={(tag) => tagPickerBoard && attachTag(tag, 'board', tagPickerBoard.id, 'boards')}
            onDetach={(tag) => tagPickerBoard && detachTag(tag, 'board', tagPickerBoard.id, 'boards')}
            onCreateAndAttach={(path, icon, color) =>
              tagPickerBoard && createAndAttachTag(path, icon, color, 'board', tagPickerBoard.id, 'boards')
            }
            onRenameTag={renameTag}
            onClose={() => setTagPickerBoardId(null)}
          />

          <TagPicker
            visible={bulkTagPickerVisible}
            kind="board"
            tags={tags}
            selectedTagIds={[]}
            onAttach={bulkAttachTag}
            onDetach={() => {}}
            onCreateAndAttach={bulkCreateAndAttachTag}
            onRenameTag={renameTag}
            onClose={() => setBulkTagPickerVisible(false)}
          />

          <GroupPickerSheet
            visible={bulkGroupPickerVisible}
            kind="board"
            groups={groups}
            onPick={bulkAssignGroup}
            onClose={() => setBulkGroupPickerVisible(false)}
          />

          <RenamePrompt
            visible={explorer.folderPrompt !== null}
            title={explorer.folderPrompt?.mode === 'rename' ? 'Назва папки' : 'Нова папка'}
            initialValue={explorer.folderPrompt?.mode === 'rename' ? nameOf(explorer.folderPrompt.path) : ''}
            onCancel={() => explorer.setFolderPrompt(null)}
            onSave={(name) => explorer.saveFolderName(name)}
          />

          <RenamePrompt
            visible={renamingBoard !== null}
            title="Назва дошки"
            initialValue={renamingBoard?.title ?? ''}
            onCancel={() => setRenamingBoard(null)}
            onSave={(title) => {
              if (renamingBoard) renameBoard(renamingBoard, title);
            }}
          />
        </>
      }
    >
      {(listTopPad, listProps) =>
        isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : loadError ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="alert-circle-outline" size={32} color={ACCENT} />
            </View>
            <Text style={styles.emptyLabel}>Не вдалося прочитати дошки</Text>
            <Text style={styles.emptyHint}>{loadError}</Text>
          </View>
        ) : boardsHere.length === 0 && explorer.folders.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="apps-outline" size={32} color={ACCENT} />
            </View>
            <Text style={styles.emptyLabel}>{needle ? 'Нічого не знайдено' : 'Ще немає дощок'}</Text>
            <Text style={styles.emptyHint}>
              {needle
                ? 'Спробуйте інше слово'
                : 'Дошка - вільний канвас для карток, які потім можна зібрати в документ'}
            </Text>
          </View>
        ) : (
          <ScrollView
            {...listProps}
            contentContainerStyle={[
              viewMode === 'cards' ? styles.tileGrid : styles.list,
              viewMode !== 'cards' && isTwoPane && styles.listWide,
              { paddingTop: listTopPad },
              isSelectMode && styles.listWithBulkBar,
            ]}
          >
            {/* Where you are and what folders are here - only in
                explorer mode; in the other two this draws nothing. */}
            {/* Full width even inside the wrapped row of boards - as a
                plain child it became one more item in that row and was
                squeezed to the width of its own icon. */}
            {list.explorerMode && (
              <View style={styles.headSpan}>
              <ExplorerHead
                crumbs={explorer.crumbs}
                path={explorer.path}
                folders={explorer.folders}
                showCrumbs={explorer.active}
                columns={isTwoPane ? (layoutWidth > layoutHeight ? 3 : 2) : 1}
                itemIcon="apps-outline"
                onGo={(next) => {
                  explorer.setPath(next);
                  // A folder found by searching is a place to go: the
                  // search is over once it is entered.
                  if (needle !== '') {
                    list.setSearchQuery('');
                    list.setIsSearching(false);
                  }
                }}
                onUp={() => explorer.setPath((prev) => prev.split('/').slice(0, -1).join('/'))}
                onFolderMenu={openFolderMenu}
              />
              </View>
            )}
            {viewMode === 'cards'
              ? boardsHere.map((board) => renderBoardTile(board, tileWidth))
              : boardsHere.map(renderBoardRow)}
            {/* What else is in this group - see GroupSections. */}
            <GroupSections groupId={list.selectedGroupId} currentKind="board" tags={tags} />
          </ScrollView>
        )
      }
    </DatabaseChrome>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Stood on its end, like every other screen's.
  // Turned with the capsule.
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#EDE9FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabel: {
    marginTop: 16,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  emptyHint: {
    marginTop: 6,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingLeft: 20,
    // Clear of the rail, like the row list.
    paddingRight: RAIL_CLEARANCE,
    paddingBottom: 140,
  },
  // Room for the bulk-action bar while choosing, so the last board can
  // still be scrolled out from under it.
  listWithBulkBar: {
    paddingBottom: 90,
  },
  tile: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
  },
  tileMap: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  tileEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBody: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  // Two across where the screen is wide enough - see isTwoPane above.
  listWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  headSpan: {
    width: '100%',
  },
  rowHalf: {
    width: '49%',
  },
  list: {
    paddingLeft: 20,
    // The rail stands at the right edge; the rows stop short of it rather
    // than running under it - the same clearance the calendar keeps.
    paddingRight: RAIL_CLEARANCE,
    gap: 10,
    // Clears FloatingIslandTabBar the same way DocumentsScreen's list does -
    // without it the last board sits permanently under the island.
    paddingBottom: 120,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  rowIcon: {
    width: 52,
    height: 52,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
  },
  rowMeta: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
  },
  rowActionButton: {
    padding: 6,
  },
});
