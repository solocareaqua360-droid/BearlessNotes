import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Path, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { DocumentItem, Group, SketchElement } from '../types';
import { groupAppliesTo } from '../utils/groups';
import { hapticButtonDown, hapticButtonUp } from '../utils/haptics';
import { RootStackParamList } from '../navigation';
import { useTags, detachTagFromDeletedItem, ITEMS_COLLECTION_BY_KIND } from '../hooks/useTags';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import DocumentEditorScreen from './DocumentEditorScreen';
import { useSortPref } from '../hooks/useSortPref';
import { sortItems } from '../utils/sortItems';
import SortMenuRows from '../components/SortMenuRows';
import TagsDrawer, { TagFilter, matchesTagFilter, removeTagFromFilter } from '../components/TagsDrawer';
import TabsTunnel from '../components/TabsTunnel';
import ProjectTabsRow, { UNASSIGNED_ID } from '../components/ProjectTabsRow';
import GroupPickerSheet from '../components/GroupPickerSheet';
import TagPicker from '../components/TagPicker';
import BulkActionBar from '../components/BulkActionBar';
import DocumentCard from '../components/DocumentCard';
import { extractPreview, EXPANDED_PREVIEW_LENGTH } from '../utils/documentPreview';
import { FONT_REGULAR, FONT_BOLD, FONT_SEMIBOLD } from '../utils/fonts';
import StickerComposer from '../components/StickerComposer';
import ZoomableImageViewer from '../components/ZoomableImageViewer';
import SketchEditor from '../components/SketchEditor';

// Палітра №3 (Теплий Теракотовий) - the create/edit action color across
// this redesign; replaces the old blue ACCENT wherever this screen used it.
const ACCENT = '#BE7657';
const documentsCollection = collection(db, 'documents');
const groupsCollection = collection(db, 'groups');
const documentsPrefsDoc = doc(db, 'settings', 'documentsPrefs');
const stickersCollection = collection(db, 'stickers');
const STICKER_YELLOW = '#FBE97A';
const STICKER_DARK = '#4a3f05';
// Exported so ShareIntentHandler can apply the same cap when a shared
// text lands as a standalone sticker instead of through the FAB here.
export const FREE_STICKER_LIMIT = 10;

type ViewMode = 'list' | 'grid';

type StripSticker = {
  id: string;
  type: 'paragraph' | 'image' | 'sketch';
  text?: string;
  imageUri?: string;
  sketchElements?: SketchElement[];
  sketchWidth?: number;
  sketchHeight?: number;
  usedInDocuments?: Record<string, true>;
  trashed?: boolean;
};

export default function DocumentsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // react-native-svg's own "100%" width/height on the root <Svg> doesn't
  // reliably re-measure when the window itself resizes at runtime (seen on
  // a Fold: the gradient stayed sized to the folded width after unfolding)
  // - useWindowDimensions re-renders on that resize, so passing explicit
  // pixel width/height keeps the gradient's canvas in sync with it.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // A Fold's inner screen (and a tablet, and DeX) is wide enough to hold
  // the list and the document open beside it instead of pushing the editor
  // over the top of the list. Folding the phone shut resizes the window,
  // which drops straight back to one column with the same document still
  // remembered - unfolding brings it back where it was.
  const { isTwoPane, listPaneWidth } = useResponsiveLayout();
  // Which document the right-hand pane holds. Only ever read in two-pane
  // mode; on a phone a document is a pushed screen, as before.
  const [openDoc, setOpenDoc] = useState<{ id: string; autoFocusTitle?: boolean } | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<TagFilter | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const { tags, attachTag, detachTag, createAndAttachTag, renameTag } = useTags();
  const {
    isSelectMode,
    selectedIds,
    toggleSelectMode,
    toggle: toggleSelected,
    clear: clearSelection,
  } = useMultiSelect();
  const { sortPref, selectSortField } = useSortPref('documentsPrefs');
  const [bulkTagPickerVisible, setBulkTagPickerVisible] = useState(false);
  const [bulkGroupPickerVisible, setBulkGroupPickerVisible] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [menuOpen, setMenuOpen] = useState(false);
  const [stickersCollapsed, setStickersCollapsed] = useState(false);
  const [freeStickers, setFreeStickers] = useState<StripSticker[]>([]);
  const [stickerComposerVisible, setStickerComposerVisible] = useState(false);
  const [editingTextSticker, setEditingTextSticker] = useState<{ id: string; text: string } | null>(null);
  const [viewerImageUri, setViewerImageUri] = useState<string | null>(null);
  const [sketchEditing, setSketchEditing] = useState<StripSticker | null>(null);
  // Visual feedback while the FAB's long-press-to-create-a-sticker gesture
  // is armed - see the FAB's onLongPress/onPressOut below.
  const [fabPressed, setFabPressed] = useState(false);

  useEffect(() => {
    return onSnapshot(documentsPrefsDoc, (snapshot) => {
      const data = snapshot.data();
      setViewMode((data?.viewMode as ViewMode | undefined) ?? 'list');
      setStickersCollapsed(!!data?.stickersCollapsed);
    });
  }, []);

  useEffect(() => {
    // Filtered client-side (same "avoid a composite index" tradeoff as
    // everywhere else in this app) - only stickers with nothing in
    // usedInDocuments and not trashed belong in this "free stash" strip.
    // The full "Стікери" database screen shows every sticker regardless.
    return onSnapshot(query(stickersCollection, orderBy('updatedAt', 'desc')), (snapshot) => {
      setFreeStickers(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<StripSticker, 'id'>) }))
          .filter((s) => !s.trashed && Object.keys(s.usedInDocuments ?? {}).length === 0)
      );
    });
  }, []);

  function toggleStickersCollapsed() {
    setDoc(documentsPrefsDoc, { stickersCollapsed: !stickersCollapsed }, { merge: true });
  }

  function openStickerComposer() {
    if (freeStickers.length >= FREE_STICKER_LIMIT) {
      Alert.alert(
        'Забагато вільних стікерів',
        `Спершу розмісти якийсь із наявних ${FREE_STICKER_LIMIT} стікерів у документі чи календарі, щоб звільнити місце.`
      );
      return;
    }
    setEditingTextSticker(null);
    setStickerComposerVisible(true);
  }

  // Tapping a sticker in the strip: text/sketch open for editing in place;
  // a photo sticker only opens the enlarged viewer (same distinction
  // StickersScreen's own database view makes).
  function openFreeSticker(sticker: StripSticker) {
    if (sticker.type === 'paragraph') {
      setEditingTextSticker({ id: sticker.id, text: sticker.text ?? '' });
      setStickerComposerVisible(true);
    } else if (sticker.type === 'image' && sticker.imageUri) {
      setViewerImageUri(sticker.imageUri);
    } else if (sticker.type === 'sketch') {
      setSketchEditing(sticker);
    }
  }

  function saveSketchEdit(elements: SketchElement[], width: number, height: number) {
    if (!sketchEditing) return;
    updateDoc(doc(db, 'stickers', sketchEditing.id), {
      sketchElements: elements,
      sketchWidth: width,
      sketchHeight: height,
      updatedAt: Date.now(),
    });
    setSketchEditing(null);
  }

  useEffect(() => {
    const documentsQuery = query(documentsCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(documentsQuery, (snapshot) => {
      setDocuments(
        snapshot.docs
          // Daily notes (CalendarScreen) live in this same collection but
          // belong to the calendar, not this list.
          .filter((docSnapshot) => !docSnapshot.data().calendarDate)
          .map((docSnapshot) => ({
            id: docSnapshot.id,
            title: docSnapshot.data().title,
            updatedAt: docSnapshot.data().updatedAt,
            tagIds: docSnapshot.data().tagIds ?? [],
            blocks: docSnapshot.data().blocks ?? [],
            groupId: docSnapshot.data().groupId,
            createdAt: docSnapshot.data().createdAt,
            coverImageUri: docSnapshot.data().coverImageUri,
          }))
      );
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    // Filtered client-side rather than with a `where('kind','==','document')`
    // query, same tradeoff as Files/Photos/Links - combining an equality
    // filter with `orderBy` on a different field needs a hand-set-up
    // composite index.
    return onSnapshot(query(groupsCollection, orderBy('name')), (snapshot) => {
      setGroups(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) }))
          .filter((g) => groupAppliesTo(g, 'document'))
      );
    });
  }, []);

  const groupFilteredDocuments =
    groupFilter === null
      ? documents
      : groupFilter === UNASSIGNED_ID
        ? documents.filter((d) => !d.groupId)
        : documents.filter((d) => d.groupId === groupFilter);
  const tagFilteredDocuments = groupFilteredDocuments.filter((item) =>
    matchesTagFilter(item.tagIds ?? [], activeFilter)
  );
  const displayedDocuments = sortItems(
    tagFilteredDocuments,
    sortPref,
    (item) => item.title || 'Без назви',
    (item) => item.createdAt,
    (item) => item.updatedAt
  );
  const selectedDocuments = documents.filter((d) => selectedIds.has(d.id));
  // Only offer tags actually assigned to at least one document - not the
  // whole app-wide tag list - same "used tags" pruning Files/Photos/Links
  // already apply to their own drawers.
  const usedTagIds = new Set(documents.flatMap((d) => d.tagIds ?? []));
  const drawerTags = tags.filter((t) => usedTagIds.has(t.id));

  // A new document created while a tag filter is active starts pre-tagged
  // with whatever that filter selects - both an 'isolating' (AND) filter's
  // several tags and a single selected tag in 'multi' (OR) mode land the
  // note back under that same filter right away, instead of it vanishing
  // from the currently-filtered view the moment it's created.
  // A document deleted from the list (on its own or in a bulk select)
  // leaves the pane holding a document that no longer exists - it empties
  // instead. Guarded on isLoading so the very first render, before the
  // subscription has delivered anything, doesn't count as "gone".
  useEffect(() => {
    if (!openDoc || isLoading) return;
    if (!documents.some((d) => d.id === openDoc.id)) setOpenDoc(null);
  }, [documents, isLoading, openDoc]);

  // The one place that decides what "open a document" means: a pane on a
  // wide screen, a pushed screen on a narrow one.
  function openDocument(id: string, autoFocusTitle?: boolean) {
    if (isTwoPane) {
      setOpenDoc({ id, autoFocusTitle });
      return;
    }
    navigation.navigate('Editor', autoFocusTitle ? { documentId: id, autoFocusTitle: true } : { documentId: id });
  }

  async function createDocument() {
    const now = Date.now();
    const newDoc = await addDoc(documentsCollection, {
      title: 'Без назви',
      createdAt: now,
      updatedAt: now,
      blocks: [],
      // A note created while a real group tab (not "Всі"/"Без групи") is
      // selected starts pre-assigned to it, same idea as the tag filter
      // below - it lands back in the currently-filtered view instead of
      // vanishing into "Без групи" the moment it's created.
      ...(groupFilter && groupFilter !== UNASSIGNED_ID ? { groupId: groupFilter } : {}),
    });
    if (activeFilter?.type === 'tags') {
      const filterTags = activeFilter.tagIds.map((id) => tags.find((t) => t.id === id)).filter((t) => t != null);
      await Promise.all(
        filterTags.map((tag) => attachTag(tag, 'document', newDoc.id, ITEMS_COLLECTION_BY_KIND.document))
      );
    }
    openDocument(newDoc.id, true);
  }

  async function changeViewMode(mode: ViewMode) {
    setMenuOpen(false);
    await setDoc(documentsPrefsDoc, { viewMode: mode }, { merge: true });
  }

  async function confirmDeleteDocument(id: string) {
    const snapshot = await getDoc(doc(db, 'documents', id));
    const docTagIds: string[] = snapshot.data()?.tagIds ?? [];
    deleteDoc(doc(db, 'documents', id));
    await Promise.all(
      docTagIds.map((tagId) => {
        const tag = tags.find((t) => t.id === tagId);
        return tag ? detachTagFromDeletedItem(tag, 'document', id) : Promise.resolve();
      })
    );
  }

  function confirmDeleteSelected() {
    const toDelete = selectedDocuments;
    Alert.alert(toDelete.length === 1 ? 'Видалити документ?' : `Видалити документи (${toDelete.length})?`, undefined, [
      { text: 'Скасувати', style: 'cancel' },
      {
        text: 'Видалити',
        style: 'destructive',
        onPress: async () => {
          await Promise.all(toDelete.map((d) => confirmDeleteDocument(d.id)));
          clearSelection();
        },
      },
    ]);
  }

  async function bulkAttachTag(tag: Parameters<typeof attachTag>[0]) {
    setBulkTagPickerVisible(false);
    await Promise.all(selectedDocuments.map((d) => attachTag(tag, 'document', d.id, ITEMS_COLLECTION_BY_KIND.document)));
    clearSelection();
  }

  async function bulkCreateAndAttachTag(path: string, icon: string, color: string) {
    setBulkTagPickerVisible(false);
    await Promise.all(
      selectedDocuments.map((d) =>
        createAndAttachTag(path, icon, color, 'document', d.id, ITEMS_COLLECTION_BY_KIND.document)
      )
    );
    clearSelection();
  }

  async function bulkAssignGroup(groupId: string | null) {
    setBulkGroupPickerVisible(false);
    const batch = writeBatch(db);
    selectedDocuments.forEach((d) => {
      batch.update(doc(db, 'documents', d.id), { groupId: groupId ?? deleteField() });
    });
    await batch.commit();
    clearSelection();
  }

  return (
    <View style={styles.container}>
      {/* Page background: a fixed gradient (react-native-svg, already a
          native dep for sketches - no new build needed) rather than
          expo-linear-gradient, which would be a brand-new native module
          and mean another EAS dev-client build. */}
      {/* 1px bled past every edge - windowWidth/Height can round to a hair
          less than the actual screen, leaving a sliver of the default
          white background visible at an edge otherwise. */}
      <Svg
        width={windowWidth + 2}
        height={windowHeight + 2}
        style={[StyleSheet.absoluteFill, { top: -1, left: -1 }]}
        pointerEvents="none"
      >
        <Defs>
          {/* Dialed in via the gradient editor artifact - dark warm brown
              at the top, gray-green through the middle, fading to black
              over the bottom half. */}
          <LinearGradient id="documentsBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth + 2} height={windowHeight + 2} fill="url(#documentsBg)" />
      </Svg>

      {/* One column on a phone, two on a Fold's inner screen: the list keeps
          its own width and the open document takes the rest. Everything
          that floats over the whole window - the tag drawer, the modals
          below - stays outside this row, so a drawer still covers the
          screen rather than half of it. */}
      <View style={styles.paneRow}>
        <View style={[styles.pane, isTwoPane && { flex: 0, width: listPaneWidth }]}>
        <View style={styles.headerRow}>
          <Text style={styles.header}>Документи</Text>
        </View>

        {menuOpen && <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />}
        {menuOpen && (
          <View style={styles.menuPanel}>
            <Text style={styles.menuSectionLabel}>Вигляд</Text>
            <Pressable style={styles.menuRow} onPress={() => changeViewMode('list')}>
              <Ionicons name="reorder-four-outline" size={17} color="#111827" />
              <Text style={styles.menuRowLabel}>Список</Text>
              {viewMode === 'list' && <Ionicons name="checkmark" size={18} color={ACCENT} />}
            </Pressable>
            <Pressable style={styles.menuRow} onPress={() => changeViewMode('grid')}>
              <Ionicons name="grid-outline" size={17} color="#111827" />
              <Text style={styles.menuRowLabel}>Сітка</Text>
              {viewMode === 'grid' && <Ionicons name="checkmark" size={18} color={ACCENT} />}
            </Pressable>
            <SortMenuRows sortPref={sortPref} onSelectField={selectSortField} accentColor={ACCENT} />
          </View>
        )}

        {/* Groups and the whole control capsule share one row - the title
            keeps the line above to itself, same as CustomDatabaseScreen.
            The capsule's fourth button is what shows/hides the sticker
            strip below. */}
        <View style={styles.groupsRow}>
          {groups.length > 0 ? (
            <TabsTunnel>
              <ProjectTabsRow
                items={groups}
                selected={groupFilter}
                onSelect={setGroupFilter}
                unassignedLabel="Без групи"
                dark
              />
            </TabsTunnel>
          ) : (
            <View style={styles.groupsSpacer} />
          )}
          <View style={[styles.headerButtons, groups.length > 0 && styles.headerButtonsOffset]}>
            <Pressable hitSlop={6} onPress={() => navigation.navigate('Search')}>
              <Ionicons name="search" size={17} color="#fff" />
            </Pressable>
            <View style={styles.headerButtonsDivider} />
            <Pressable hitSlop={6} onPress={() => setMenuOpen((v) => !v)}>
              <Ionicons name="ellipsis-horizontal" size={17} color="#fff" />
            </Pressable>
            <View style={styles.headerButtonsDivider} />
            <Pressable hitSlop={6} onPress={toggleSelectMode}>
              <Ionicons name={isSelectMode ? 'close' : 'checkmark-circle-outline'} size={17} color="#fff" />
            </Pressable>
            <View style={styles.headerButtonsDivider} />
            <Pressable hitSlop={6} onPress={toggleStickersCollapsed}>
              <Ionicons name={stickersCollapsed ? 'albums-outline' : 'albums'} size={17} color="#fff" />
            </Pressable>
          </View>
        </View>

        {!stickersCollapsed && freeStickers.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.stickerScroll}
            contentContainerStyle={styles.stickerStrip}
          >
            {freeStickers.map((s) => (
              <Pressable key={s.id} style={styles.stickerCard} onPress={() => openFreeSticker(s)}>
                {s.type === 'image' && s.imageUri ? (
                  <Image source={{ uri: s.imageUri }} style={styles.stickerCardImage} resizeMode="cover" />
                ) : s.type === 'sketch' && (s.sketchElements?.length ?? 0) > 0 ? (
                  // Same viewBox-reuses-the-capture-canvas-size approach as
                  // DocumentEditorScreen's own sketch block preview - the
                  // drawing scales correctly into this much smaller box.
                  <Svg width="100%" height="100%" viewBox={`0 0 ${s.sketchWidth || 1} ${s.sketchHeight || 1}`}>
                    {(s.sketchElements ?? []).map((el, i) =>
                      el.kind === 'text' ? (
                        <SvgText key={i} x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize}>
                          {el.text}
                        </SvgText>
                      ) : (
                        <Path
                          key={i}
                          d={el.d}
                          stroke={el.color}
                          strokeWidth={el.width}
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )
                    )}
                  </Svg>
                ) : s.type === 'sketch' ? (
                  <View style={styles.stickerCardIconWrap}>
                    <Ionicons name="brush-outline" size={34} color={STICKER_DARK} />
                  </View>
                ) : (
                  <Text style={styles.stickerCardText} numberOfLines={6}>
                    {s.text || 'Порожній стікер'}
                  </Text>
                )}
              </Pressable>
            ))}
          </ScrollView>
        )}

        <StickerComposer
          visible={stickerComposerVisible}
          editingTextSticker={editingTextSticker}
          onClose={() => {
            setStickerComposerVisible(false);
            setEditingTextSticker(null);
          }}
        />

        {viewerImageUri && (
          // Modal (its own native window on Android) rather than a plain
          // absolute-positioned overlay - without it this rendered inside the
          // Documents tab's own layout and left the real status bar showing
          // as a solid black strip above it, instead of the immersive
          // full-screen viewer this needs (see the same pattern's own
          // comment in DocumentEditorScreen). GestureHandlerRootView has to
          // be re-declared inside the Modal for its own separate native
          // window - the app-level one in App.tsx doesn't reach in here.
          <Modal visible transparent animationType="fade" onRequestClose={() => setViewerImageUri(null)}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <ZoomableImageViewer uri={viewerImageUri} onClose={() => setViewerImageUri(null)} />
            </GestureHandlerRootView>
          </Modal>
        )}

        <SketchEditor
          visible={sketchEditing !== null}
          initialElements={sketchEditing?.sketchElements ?? []}
          onSave={saveSketchEdit}
          onClose={() => setSketchEditing(null)}
        />

        {activeFilter && (
          <View style={styles.filterRow}>
            {activeFilter.type === 'untagged' ? (
              <View style={[styles.filterChip, { borderColor: '#6B7280' }]}>
                <Ionicons name="pricetag-outline" size={13} color="#6B7280" />
                <Text style={[styles.filterChipLabel, { color: '#6B7280' }]}>Без тегів</Text>
                <Pressable hitSlop={8} onPress={() => setActiveFilter(null)}>
                  <Ionicons name="close" size={14} color="#6B7280" />
                </Pressable>
              </View>
            ) : (
              activeFilter.tagIds.map((tagId) => {
                const tag = tags.find((t) => t.id === tagId);
                if (!tag) return null;
                return (
                  <View key={tagId} style={[styles.filterChip, { borderColor: tag.color }]}>
                    <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={13} color={tag.color} />
                    <Text style={[styles.filterChipLabel, { color: tag.color }]}>{tag.path}</Text>
                    <Pressable hitSlop={8} onPress={() => setActiveFilter(removeTagFromFilter(activeFilter, tagId))}>
                      <Ionicons name="close" size={14} color={tag.color} />
                    </Pressable>
                  </View>
                );
              })
            )}
          </View>
        )}

        {isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={ACCENT} />
          </View>
        ) : displayedDocuments.length === 0 ? (
          <View style={styles.emptyState}>
            {documents.length === 0 ? (
              <>
                <Pressable style={styles.emptyIcon} onPress={createDocument}>
                  <Ionicons name="document-text-outline" size={32} color={ACCENT} />
                  <View style={styles.emptyBadge}>
                    <Ionicons name="add" size={14} color="#fff" />
                  </View>
                </Pressable>
                <Text style={styles.emptyLabel}>Створити новий документ</Text>
              </>
            ) : (
              <Text style={styles.emptyLabel}>Немає документів із цим фільтром</Text>
            )}
          </View>
        ) : (
          <FlatList
            // FlatList throws if numColumns changes on an already-mounted
            // instance - key forces a clean remount when switching views.
            key={viewMode}
            data={displayedDocuments}
            keyExtractor={(item) => item.id}
            // FlatList only re-renders an already-mounted row when `data` or
            // `extraData` changes - isSelectMode/selectedIds live outside
            // `data`, so without this a card kept showing its pre-select-mode
            // props (tapping it still navigated instead of toggling a
            // checkbox) even though renderItem's own closure had the fresh
            // values.
            extraData={[isSelectMode, selectedIds]}
            numColumns={viewMode === 'grid' ? 2 : 1}
            columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              // Grid cards reclaim the thumbnail's space for text when a
              // document has no image (see DocumentCard's own noImage
              // handling) - list rows are unaffected, so they keep the
              // short default length.
              const { imageUri, imageUris, previewText, checklistItems } = extractPreview(
                item.blocks,
                item.coverImageUri,
                viewMode === 'grid' ? EXPANDED_PREVIEW_LENGTH : undefined
              );
              return (
                <DocumentCard
                  id={item.id}
                  title={item.title}
                  updatedAt={item.updatedAt}
                  imageUri={imageUri}
                  imageUris={imageUris}
                  previewText={previewText}
                  checklistItems={checklistItems}
                  onPress={() => openDocument(item.id)}
                  isSelectMode={isSelectMode}
                  isSelected={selectedIds.has(item.id)}
                  onToggleSelect={() => toggleSelected(item.id)}
                  layout={viewMode}
                />
              );
            }}
          />
        )}

        {!isSelectMode && (
          <Pressable
            style={[styles.fab, fabPressed && styles.fabSticker]}
            onPress={createDocument}
            // The two halves of a mechanical key: resistance under the
            // finger, rebound when it lifts (see hapticButtonDown/Up).
            onPressIn={hapticButtonDown}
            onLongPress={() => {
              setFabPressed(true);
              openStickerComposer();
            }}
            onPressOut={() => {
              hapticButtonUp();
              setFabPressed(false);
            }}
            delayLongPress={400}
          >
            <Ionicons name="add" size={28} color={fabPressed ? STICKER_DARK : '#fff'} />
          </Pressable>
        )}
        </View>

        {isTwoPane && (
          <View style={styles.editorPane}>
            {openDoc ? (
              // Keyed by id so switching documents remounts the editor
              // rather than re-seeding one instance's state mid-edit.
              <DocumentEditorScreen
                key={openDoc.id}
                pane
                documentId={openDoc.id}
                autoFocusTitle={openDoc.autoFocusTitle}
                navigation={navigation}
                onClose={() => setOpenDoc(null)}
              />
            ) : (
              <View style={styles.editorPaneEmpty}>
                <Ionicons name="document-text-outline" size={34} color="rgba(255,255,255,0.3)" />
                <Text style={styles.editorPaneEmptyLabel}>Виберіть документ зі списку</Text>
              </View>
            )}
          </View>
        )}
      </View>

      <TagsDrawer tags={drawerTags} activeFilter={activeFilter} onSelectFilter={setActiveFilter} hideOpenButton={isSelectMode} />

      <TagPicker
        visible={bulkTagPickerVisible}
        kind="document"
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
        kind="document"
        groups={groups}
        onPick={bulkAssignGroup}
        onClose={() => setBulkGroupPickerVisible(false)}
      />

      <BulkActionBar
        count={selectedIds.size}
        onTag={() => setBulkTagPickerVisible(true)}
        onGroup={() => setBulkGroupPickerVisible(true)}
        onDelete={confirmDeleteSelected}
        aboveTabBar
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  paneRow: {
    flex: 1,
    flexDirection: 'row',
  },
  pane: {
    flex: 1,
  },
  editorPane: {
    flex: 1,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  editorPaneEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  editorPaneEmptyLabel: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.5)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    // Was 56 - pushed down to roughly the level a note's own title sits at
    // in the editor (that title starts under its own back/undo/redo
    // header row, ~90px down).
    paddingTop: 90,
    paddingBottom: 8,
  },
  header: {
    // At least 2x the previous 22.
    fontSize: 46,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    // The new gradient is dark top-to-bottom (no light edge left), so the
    // title needs to sit on it in white now.
    color: '#fff',
  },
  // Search + "..." (stub) merged into one elongated glass capsule instead
  // of two separate circles.
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    // Same height as a group pill next to it (see ProjectTabsRow's tab).
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginRight: 20,
    borderRadius: 999,
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  // The tabs row's own bottom padding would otherwise leave the capsule
  // sitting lower than the pills it stands next to.
  headerButtonsOffset: {
    marginBottom: 10,
  },
  headerButtonsDivider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  menuBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 5,
  },
  menuPanel: {
    position: 'absolute',
    top: 96,
    right: 20,
    width: 200,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 6,
  },
  menuSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.04,
    textTransform: 'uppercase',
    color: '#9CA3AF',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 2,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  menuRowLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: '#111827',
  },
  gridRow: {
    gap: 12,
    paddingHorizontal: 20,
  },
  // Groups on the left, the control capsule on the right, one line.
  groupsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // Same breathing room between the tunnel and the capsule as
    // CustomDatabaseScreen's controlsRow.
    gap: 8,
    paddingBottom: 6,
  },
  // Pushes the capsule to the right when there are no groups to fill the
  // row's left side.
  groupsSpacer: {
    flex: 1,
  },
  // Without flexGrow/flexShrink: 0, this horizontal ScrollView competes for
  // height with the documents FlatList below it and gets squeezed shorter
  // than its own content (150px cards clipped) - same bug/fix as
  // ProjectTabsRow's own `scroll` style documents.
  stickerScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  stickerStrip: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    gap: 10,
  },
  stickerCard: {
    width: 150,
    height: 150,
    borderRadius: 6,
    backgroundColor: STICKER_YELLOW,
    padding: 14,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 4,
  },
  stickerCardImage: {
    width: '100%',
    height: '100%',
    borderRadius: 4,
  },
  stickerCardIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickerCardText: {
    fontSize: 14,
    lineHeight: 19,
    color: STICKER_DARK,
    fontWeight: '500',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  // White capsule, border in the tag's own (muted) color, text the same
  // color - borderColor/color are set per-chip inline (tag.color), this
  // just carries the shared shape.
  filterChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  filterChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: 'rgba(190,118,87,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  emptyLabel: {
    marginTop: 16,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.85)',
  },
  list: {
    paddingVertical: 8,
    paddingBottom: 120,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 100,
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    // Colored shadow (matches the button's own hue) instead of a plain
    // black one.
    shadowColor: ACCENT,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
  },
  // Long-pressing the FAB switches it to sticker-creation mode - the color
  // swap away from ACCENT is the only feedback the gesture has fired,
  // since it fires while still held rather than on release.
  fabSticker: {
    backgroundColor: STICKER_YELLOW,
    shadowColor: STICKER_YELLOW,
  },
});
