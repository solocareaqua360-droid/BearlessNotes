import { useEffect, useState } from 'react';
import { CoverGradientView, defaultCoverFor } from '../theme/covers';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { withAlpha } from '../utils/color';
import type { Theme } from '../theme/tokens';
import { useRecordColour } from '../theme/ThemeProvider';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDockClearance } from '../navigation/dockGeometry';
import { Ionicons } from '@expo/vector-icons';
import { GestureDetector } from 'react-native-gesture-handler';
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
import { BoardsStackParamList, RootStackParamList } from '../navigation';
import { TAB_SCREENS } from '../navigation/tabScreens';
import { BoardCard, BoardColumn, BoardItem } from '../types';
import { readBoardPart } from '../utils/boardStorage';
import BoardMiniMap from '../components/BoardMiniMap';
import DatabaseChrome from '../components/DatabaseChrome';
import GroupPickerSheet from '../components/GroupPickerSheet';
import ProjectBadge from '../components/ProjectBadge';
import TagPicker from '../components/TagPicker';
import GroupSections from '../components/GroupSections';
import { useDatabaseList } from '../hooks/useDatabaseList';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { useExplorer, ExplorerFolder, nameOf } from '../hooks/useExplorer';
import ExplorerHead from '../components/ExplorerHead';
import { useExplorerCarry } from '../hooks/useExplorerCarry';
import CardCarryOverlay from '../components/CardCarryOverlay';
import UndoToast from '../components/UndoToast';
import RenamePrompt from '../components/RenamePrompt';
import { MAX_CONTENT_WIDTH } from '../components/ContentColumn';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { BlurView } from 'expo-blur';
import { GlassPortal } from '../components/GlassPortal';
import { useBlurTarget } from '../components/GlassTarget';
import { railClear } from '../constants/rail';
import { ask, confirm } from '../components/surfaces/Ask';
import { listenError } from '../utils/listenError';

// The "+" fill: the accent at half strength, since the blur behind it is
// what separates it from the screen (see DatabaseChrome).
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
  const theme = useTheme();
  const accent = theme.sections.boards;
  const accentGlass = withAlpha(accent, 0.55);
  const styles = useStyles(makeStyles);
  const recordColour = useRecordColour();
  const insets = useSafeAreaInsets();
  const dockClear = useDockClearance();
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
    }, listenError('BoardsListScreen:settings'));
  }, []);
  async function changeViewMode(mode: 'list' | 'cards') {
    setViewMode(mode);
    await setDoc(doc(db, 'settings', 'boardsPrefs'), { viewMode: mode }, { merge: true });
  }
  const [renamingBoard, setRenamingBoard] = useState<BoardItem | null>(null);
  const [tagPickerBoardId, setTagPickerBoardId] = useState<string | null>(null);
  const [bulkTagPickerVisible, setBulkTagPickerVisible] = useState(false);
  const [bulkGroupPickerVisible, setBulkGroupPickerVisible] = useState(false);
  // The badge on a single card, opened outside select mode - distinct
  // from the bulk sheet above, which acts on the whole selection.
  const [singleGroupTargetId, setSingleGroupTargetId] = useState<string | null>(null);

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
    createAndAttachTagToMany,
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
    await createAndAttachTagToMany(path, icon, color, 'board', selectedBoards.map((b) => b.id), 'boards');
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

  async function assignSingleGroup(groupId: string | null) {
    const targetId = singleGroupTargetId;
    setSingleGroupTargetId(null);
    if (!targetId) return;
    await updateDoc(doc(db, 'boards', targetId), { groupId: groupId ?? deleteField() });
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

  // Carrying a board into a folder - see useExplorerCarry.
  const carrying = useExplorerCarry<BoardItem>({
    path: explorer.path,
    folders: explorer.folders,
    moveItem: (item, destination) => explorer.moveItem(item, destination),
    items: boards,
    isSelectMode,
    selectedIds,
    active: explorer.active,
    onMoved: () => {
      if (isSelectMode) clearSelection();
    },
  });

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
  // The tile width is an exact number of pixels, so it has to be worked
  // out from the SAME margins the grid actually uses. It reads 20 here
  // because the grid keeps 10 a side (railClear at the call site) - and
  // this is where the rail's removal was really felt: the sides were
  // 20 + 90, so two tiles worked out from a screen minus 20 could never
  // fit in a screen minus 110, and the row wrapped to one column every
  // time. "Сітка квадратів в один ряд хоча могла бути в два ряди."
  const gridWidth = Math.min(windowWidth, MAX_CONTENT_WIDTH) - 20;
  const tileColumns = Math.max(2, Math.min(4, Math.floor(gridWidth / 300)));
  const tileWidth = Math.floor((gridWidth - 12 * (tileColumns - 1)) / tileColumns);

  async function createBoard() {
    const now = Date.now();
    // A MAP, not an array. A board's parts were arrays once and are
    // keyed maps now, and BoardScreen refuses to write anything while it
    // cannot tell which shape a board is in - it only believes "array"
    // when the SERVER says so, and a board just made is read from the
    // cache. Born as an array, a new board therefore sat in that doubt
    // for ever and saved nothing at all: everything put on it was lost
    // on the way out. Born keyed, there is nothing to doubt.
    const ref = await addDoc(boardsCollection, { title: 'Без назви', cards: {}, createdAt: now, updatedAt: now });
    // Made inside a folder, it belongs to that folder - see useExplorer.
    await explorer.assignToCurrentFolder(ref.id);
    openBoardById(ref.id);
  }

  // From the tab's own list a board is a route in the tab's nested stack;
  // from a copy pushed over the tile board it is a route on the ROOT
  // stack, because the copy is not inside that nested stack at all.
  function openBoardById(boardId: string) {
    if (standalone) {
      (navigation as unknown as NativeStackNavigationProp<RootStackParamList>).navigate('BoardCopy', { boardId });
      return;
    }
    navigation.navigate('Board', { boardId });
  }

  function openBoard(board: BoardItem) {
    openBoardById(board.id);
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
    const { background, text, textMuted } = recordColour(item.id);
    // Carried, the row gives up its own onLongPress - the drag gesture
    // opens the menu itself, on its own timing, rather than racing it.
    const carried = explorer.active;
    const carriedProps = carried ? carrying.cardProps(item, () => askBoardActions(item)) : undefined;
    const row = (
      <Pressable
        key={item.id}
        ref={carriedProps?.cardRef}
        collapsable={false}
        style={[
          styles.row,
          isTwoPane && styles.rowHalf,
          { backgroundColor: background },
          carriedProps?.dimmed && styles.carried,
        ]}
        onPress={() => (isSelectMode ? toggleSelected(item.id) : openBoard(item))}
        onLongPress={carried || isSelectMode ? undefined : () => askBoardActions(item)}
      >
        {/* The board's own layout in miniature, drawn from its cards -
            always current, because it is the cards. Falls back to the
            plain icon while there is nothing on the canvas to draw. */}
        {/* The board's own cover under its miniature - the same gradient
            a note gets, by the board's id. The map used to sit on a flat
            grey square, where its cards read as grey dots on grey. */}
        <View style={styles.rowIcon}>
          <CoverGradientView gradient={defaultCoverFor(item.id)} style={StyleSheet.absoluteFill} />
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
          <View style={styles.rowMetaRow}>
            <Text style={[styles.rowMeta, { color: textMuted }]}>
              {item.cards.length} {item.cards.length === 1 ? 'картка' : 'карток'}
            </Text>
            {!isSelectMode && (
              <ProjectBadge
                project={groups.find((g) => g.id === item.groupId) ?? null}
                onPress={() => setSingleGroupTargetId(item.id)}
                glass
              />
            )}
          </View>
        </View>
        {isSelectMode ? (
          <Pressable hitSlop={8} onPress={() => toggleSelected(item.id)} style={styles.rowActionButton}>
            <Ionicons
              name={selectedIds.has(item.id) ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={selectedIds.has(item.id) ? text : textMuted}
            />
          </Pressable>
        ) : (
          <Pressable hitSlop={8} onPress={() => askBoardActions(item)} style={styles.rowActionButton}>
            <Ionicons name="ellipsis-horizontal" size={16} color={textMuted} />
          </Pressable>
        )}
      </Pressable>
    );
    return row;
  }

  // A board as a tile: its own miniature at a size where the cards are
  // cards, with the name under it.
  function renderBoardTile(item: BoardItem, tileWidth: number) {
    const { background, text, textMuted } = recordColour(item.id);
    const mapHeight = Math.round(tileWidth * 0.72);
    const carried = explorer.active;
    const carriedProps = carried ? carrying.cardProps(item, () => askBoardActions(item)) : undefined;
    const tile = (
      <Pressable
        key={item.id}
        ref={carriedProps?.cardRef}
        collapsable={false}
        style={[
          styles.tile,
          { width: tileWidth, backgroundColor: background },
          carriedProps?.dimmed && styles.carried,
        ]}
        onPress={() => (isSelectMode ? toggleSelected(item.id) : openBoard(item))}
        onLongPress={carried || isSelectMode ? undefined : () => askBoardActions(item)}
      >
        <View style={[styles.tileMap, { height: mapHeight }]}>
          <CoverGradientView gradient={defaultCoverFor(item.id)} style={StyleSheet.absoluteFill} />
          {item.cards.length > 0 || (item.columns?.length ?? 0) > 0 ? (
            <BoardMiniMap cards={item.cards} columns={item.columns} width={tileWidth} height={mapHeight} showText />
          ) : (
            <View style={styles.tileEmpty}>
              <Ionicons name="apps-outline" size={24} color={textMuted} />
            </View>
          )}
        </View>
        {isSelectMode && (
          <View style={styles.tileSelectBadge} pointerEvents="none">
            <Ionicons
              name={selectedIds.has(item.id) ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={selectedIds.has(item.id) ? text : '#fff'}
            />
          </View>
        )}
        <View style={styles.tileBody}>
          <Text style={[styles.rowTitle, { color: text }]} numberOfLines={1}>
            {item.title || 'Без назви'}
          </Text>
          <View style={styles.rowMetaRow}>
            <Text style={[styles.rowMeta, { color: textMuted }]}>
              {item.cards.length} {item.cards.length === 1 ? 'картка' : 'карток'}
            </Text>
            {!isSelectMode && (
              <ProjectBadge
                project={groups.find((g) => g.id === item.groupId) ?? null}
                onPress={() => setSingleGroupTargetId(item.id)}
                glass
              />
            )}
          </View>
        </View>
      </Pressable>
    );
    return tile;
  }

  // The way back, for either shape this screen comes in - the user's own
  // rule: a folder first steps up one level (the explorer's own history,
  // which in the ordinary drill-down case IS the parent), and only once
  // there is no folder left to leave does it leave the screen itself. A
  // COPY leaves to whoever pushed it; the tab's own root has no stack to
  // pop, so it steps to the desk BEFORE this one in the ring instead -
  // "на попередній робочий стіл, у випадку дошок це календар".
  const deskIndex = TAB_SCREENS.findIndex((s) => s.name === 'Дошки');
  const previousDesk = deskIndex > 0 ? TAB_SCREENS[deskIndex - 1].name : undefined;
  function goBack() {
    if (explorer.historyState.canBack) {
      explorer.back();
      return;
    }
    if (standalone) {
      navigation.goBack();
      return;
    }
    if (previousDesk) (navigation.getParent() as any)?.navigate(previousDesk);
  }

  return (
    <DatabaseChrome<BoardItem>
      list={list}
      accent={accent}
      accentGlass={accentGlass}
      // A tab's own root has nowhere to go back to and the island at its
      // foot; a COPY pushed over the tile board has a way back and no
      // island, like every other pushed screen.
      hasIsland={!standalone}
      onBack={goBack}
      leaveIcon="easel-outline"
      // In another screen's pane the rail stands on the window's OUTER
      // edge, which is the left one - against the divider it would be in
      // the way of both halves.
      railSide={inPane ? 'left' : 'right'}
      searchPlaceholder="Пошук дощок"
      // The first screen with its functions at the top and only going
      // places in the dock - see DatabaseChrome's topBar.
      topBar={{ title: 'Дошки' }}
      onAdd={createBoard}
      addIcon="easel-outline"
      explorer={{
        mode: list.listMode,
        onChangeMode: list.setListMode,
        active: explorer.active,
        onNewFolder: () => explorer.setFolderPrompt({ mode: 'new', parent: explorer.path }),
        paths: explorer.allFolderPaths,
        path: explorer.path,
        onGo: explorer.setPath,
        onNewFolderIn: (parent) => explorer.setFolderPrompt({ mode: 'new', parent }),
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
          {carrying.movedToast && <UndoToast message={carrying.toastMessage} onUndo={carrying.undoMove} />}
          {/* The floating board while one is being carried into a folder -
              see useCardCarry. Always mounted, invisible until then. */}
          <CardCarryOverlay
            carry={carrying.carry}
            label={(items) => (items.length > 1 ? `${items.length} дошки` : items[0].title || 'Без назви')}
            icon="apps-outline"
            onEnterFolder={(path) => explorer.setPath(path)}
          />
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

          <GroupPickerSheet
            visible={!!singleGroupTargetId}
            kind="board"
            groups={groups}
            onPick={assignSingleGroup}
            onClose={() => setSingleGroupTargetId(null)}
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
      {(listTopPad, listProps, _listWidth, scrollY) => {
        carrying.scrollYRef.current = scrollY;
        return isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : loadError ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="alert-circle-outline" size={32} color={accent} />
            </View>
            <Text style={styles.emptyLabel}>Не вдалося прочитати дошки</Text>
            <Text style={styles.emptyHint}>{loadError}</Text>
          </View>
        ) : // boardsHere, not boardsHere: stepping into an empty folder
        // mid-carry would otherwise swap the list for the empty state and
        // unmount the carried row with it.
        boardsHere.length === 0 && explorer.folders.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="apps-outline" size={32} color={accent} />
            </View>
            <Text style={styles.emptyLabel}>{needle ? 'Нічого не знайдено' : 'Ще немає дощок'}</Text>
            <Text style={styles.emptyHint}>
              {needle
                ? 'Спробуйте інше слово'
                : 'Дошка - вільний канвас для карток, які потім можна зібрати в документ'}
            </Text>
          </View>
        ) : (
          <GestureDetector gesture={carrying.listGesture}>
          <ScrollView
            ref={carrying.scrollRef as React.RefObject<ScrollView>}
            {...listProps}
            contentContainerStyle={[
              viewMode === 'cards' ? styles.tileGrid : styles.list,
              railClear(inPane ? 'left' : 'right', viewMode === 'cards' ? 10 : 20),
              viewMode !== 'cards' && isTwoPane && styles.listWide,
              { paddingTop: listTopPad, paddingBottom: dockClear + insets.bottom },
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
                folderRef={carrying.carry.registerFolder}
                path={explorer.path}
                folders={explorer.folders}
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
          </GestureDetector>
        );
      }}
    </DatabaseChrome>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  container: {
    flex: 1,
  },
  // A board whose card is in hand right now.
  carried: {
    opacity: 0.4,
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
    // The sides come from railClear at the call site, and so must the
    // number the tile width is divided out of - see gridWidth above.
    // paddingBottom comes from the dock's own real height there too.
  },
  // Room for the bulk-action bar while choosing, so the last board can
  // still be scrolled out from under it.
  tile: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
  },
  tileMap: {
    width: '100%',
    overflow: 'hidden',
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
    // Sides and paddingBottom both come from the call site.
    gap: 10,
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
  // The cover fills it, so the old grey wash goes - and it has to clip,
  // or the gradient squares off the rounded corner.
  rowIcon: {
    width: 52,
    height: 52,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
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
  rowMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowActionButton: {
    padding: 6,
  },
  tileSelectBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 2,
  },
  });
