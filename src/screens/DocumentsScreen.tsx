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
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Path, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { GLASS_ISLAND, GLASS_TEXT, GLASS_TEXT_FAINT, GLASS_TEXT_MUTED } from '../constants/glass';
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
import ProjectTabsRow, { UNASSIGNED_ID } from '../components/ProjectTabsRow';
import GroupPickerSheet from '../components/GroupPickerSheet';
import TagPicker from '../components/TagPicker';
import BulkActionBar from '../components/BulkActionBar';
import DocumentCard from '../components/DocumentCard';
import {
  documentMatchesQuery,
  extractPreview,
  findBodyMatch,
  findTitleMatch,
  EXPANDED_PREVIEW_LENGTH,
} from '../utils/documentPreview';
import { FONT_BOLD, FONT_MEDIUM, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import StickerComposer from '../components/StickerComposer';
import ZoomableImageViewer from '../components/ZoomableImageViewer';
import SketchEditor from '../components/SketchEditor';
import { BlurView } from 'expo-blur';
import { GlassPortal } from '../components/GlassPortal';
import {
  CAPSULE_DROP,
  CHROME_TOP,
  NAV_HEIGHT,
  RAIL_CLEARANCE,
  RAIL_GAP,
  RAIL_RIGHT,
  RAIL_WIDTH,
} from '../constants/rail';
import { useRail } from '../hooks/useRail';
import { useBlurTarget } from '../components/GlassTarget';

// Палітра №3 (Теплий Теракотовий) - the create/edit action color across
// this redesign; replaces the old blue ACCENT wherever this screen used it.
const ACCENT = '#BE7657';
const documentsCollection = collection(db, 'documents');
const groupsCollection = collection(db, 'groups');
const documentsPrefsDoc = doc(db, 'settings', 'documentsPrefs');
const stickersCollection = collection(db, 'stickers');
const STICKER_YELLOW = '#FBE97A';
const STICKER_DARK = '#4a3f05';
// The rail's buttons are glass, so their own colours only tint what the
// blur behind them already carries - at full strength they were solid
// discs again.
const ACCENT_GLASS = 'rgba(190,118,87,0.55)';
const STICKER_GLASS = 'rgba(251,233,122,0.6)';
// Exported so ShareIntentHandler can apply the same cap when a shared
// text lands as a standalone sticker instead of through the FAB here.
export const FREE_STICKER_LIMIT = 10;

// The loose stickers' own group. A sentinel id, like ProjectTabsRow's own
// UNASSIGNED_ID: it is a tab, not a document in `groups`, so it can never
// be renamed away or deleted.
const STICKERS_GROUP = '__stickers__';

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
  const { isTwoPane } = useResponsiveLayout();
  // The document pane taking the whole window. Only reachable from the
  // editor's own header, and only while there are two panes to collapse.
  const [paneFullscreen, setPaneFullscreen] = useState(false);
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
  // The group tabs at the head of the screen are a convenience now that
  // the groups themselves live in the drawer - held down, the "#" button
  // puts the row away.
  const [groupsRowHidden, setGroupsRowHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Search happens here rather than on a screen of its own: it was pushing
  // a whole stack screen that kept its own second copy of the documents
  // collection just to filter the same list this one is already showing.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [freeStickers, setFreeStickers] = useState<StripSticker[]>([]);
  const [stickerComposerVisible, setStickerComposerVisible] = useState(false);
  const [editingTextSticker, setEditingTextSticker] = useState<{ id: string; text: string } | null>(null);
  const [viewerImageUri, setViewerImageUri] = useState<string | null>(null);
  const [sketchEditing, setSketchEditing] = useState<StripSticker | null>(null);
  // Visual feedback while the FAB's long-press-to-create-a-sticker gesture
  // is armed - see the FAB's onLongPress/onPressOut below.
  const [fabPressed, setFabPressed] = useState(false);
  // The floating chrome - the group tabs and the tag-filter chips - no
  // longer stands in the list's way: the list runs the whole height of
  // the pane and the cards pass UNDER the tabs and off the top of the
  // screen. So its height has to be measured, to know where the list's
  // first card rests and where the island hangs.
  const [chromeHeight, setChromeHeight] = useState(0);
  // The pane the list lives in. On a Fold the chrome must span that pane,
  // not the whole window - the open document has the other half.
  const [paneRect, setPaneRect] = useState({ x: 0, width: 0 });
  const insets = useSafeAreaInsets();
  const chromeTop = insets.top + CHROME_TOP;
  const chromeBottom = chromeTop + chromeHeight + 8;
  // The island is drawn through the portal, over the whole window, so it
  // has to withdraw when this screen isn't the one on show.
  const isFocused = useIsFocused();
  const blurTarget = useBlurTarget();
  const rail = useRail();
  // How far the list has to clear the bottom edge so its last card never
  // ends up sitting behind the navigation island - the island is the
  // tallest thing on the rail's foot and the closest to that edge.
  const listBottomPad = rail.navBottom + NAV_HEIGHT + RAIL_GAP;
  // The menu runs from the capsule's top down to the folder button under
  // it, rather than being cut to the capsule itself - at two buttons the
  // capsule is far too short to hold a menu, and the rows were clipped
  // mid-word. It is the rail's own free stretch, which is the shape the
  // menu should have anyway.
  const menuHeight = Math.max(
    180,
    windowHeight - rail.tagBottom - RAIL_WIDTH - RAIL_GAP - (chromeTop + CAPSULE_DROP)
  );


  useEffect(() => {
    return onSnapshot(documentsPrefsDoc, (snapshot) => {
      const data = snapshot.data();
      setViewMode((data?.viewMode as ViewMode | undefined) ?? 'list');
      setGroupsRowHidden(!!data?.groupsRowHidden);
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

  // Search reaches every document, not just the group in view - narrowing
  // by two things at once is rarely what anyone means by searching.
  const needle = searchText.trim();
  const searching = searchOpen && needle.length > 0;
  const searchMatches = searching
    ? documents.filter((d) => documentMatchesQuery(d.title ?? '', d.blocks, needle))
    : [];

  // The stickers' tab isn't a filter over the documents - it replaces
  // them.
  const showingStickers = groupFilter === STICKERS_GROUP;
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
    if (!documents.some((d) => d.id === openDoc.id)) {
      setOpenDoc(null);
      setPaneFullscreen(false);
    }
  }, [documents, isLoading, openDoc]);

  // Folding the phone shut takes the second pane away; full screen has to
  // go with it, or the list stays hidden on a single-column screen with
  // nothing left to bring it back.
  useEffect(() => {
    if (!isTwoPane) setPaneFullscreen(false);
  }, [isTwoPane]);

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

  function toggleGroupsRow() {
    setDoc(documentsPrefsDoc, { groupsRowHidden: !groupsRowHidden }, { merge: true });
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

  // Тhe loose stickers are a group of their own now - the last tab, the
  // one that can no more be removed than "Без групи" can. Tapping it
  // swaps the list of documents for a list of stickers, in whichever
  // view (list or grid) the documents are in.
  function stickerFace(s: StripSticker) {
    return (
      <>
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
      </>
    );
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
        {/* Hidden rather than unmounted while the document is full screen:
            the list keeps its scroll position and its subscriptions, so
            coming back out of full screen lands where it left off. */}
        <View
          style={[styles.pane, isTwoPane && !!openDoc && paneFullscreen && styles.paneHidden]}
          onLayout={(e) => setPaneRect({ x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width })}
        >

        {menuOpen && <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />}

        {/* The control capsule stands on its edge at the right of the
            screen instead of sharing a line with the group tabs - it was
            the tabs' own room it was taking. The "..." menu opens to its
            left, cut to the same height, so the two read as one object.

            Drawn through the portal for the same reason every sheet is:
            the blur has to sit OUTSIDE the view it blurs, and the screens
            are what the blur target wraps. That also puts it in window
            coordinates rather than the pane's. */}
        {isFocused && !(isTwoPane && !!openDoc && paneFullscreen) && (
        <GlassPortal>
        <View
          style={[
            styles.sideIslandLayer,
            { top: chromeTop + CAPSULE_DROP, left: paneRect.x, width: paneRect.width },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.sideIslandRow}>
            {menuOpen && (
              <View style={[styles.menuPanel, { height: menuHeight }]}>
                <BlurView
                  intensity={60}
                  tint="dark"
                  blurMethod="dimezisBlurView"
                  blurTarget={blurTarget ?? undefined}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                {/* Cut to the island's height, so the rows scroll inside
                    rather than the panel growing past it. */}
                <ScrollView contentContainerStyle={styles.menuScroll} showsVerticalScrollIndicator={false}>
                  <Text style={styles.menuSectionLabel}>Вигляд</Text>
                  <Pressable style={styles.menuRow} onPress={() => changeViewMode('list')}>
                    <Ionicons name="reorder-four-outline" size={17} color={GLASS_TEXT} />
                    <Text style={styles.menuRowLabel}>Список</Text>
                    {viewMode === 'list' && <Ionicons name="checkmark-outline" size={18} color={ACCENT} />}
                  </Pressable>
                  <Pressable style={styles.menuRow} onPress={() => changeViewMode('grid')}>
                    <Ionicons name="grid-outline" size={17} color={GLASS_TEXT} />
                    <Text style={styles.menuRowLabel}>Сітка</Text>
                    {viewMode === 'grid' && <Ionicons name="checkmark-outline" size={18} color={ACCENT} />}
                  </Pressable>
                  <SortMenuRows sortPref={sortPref} onSelectField={selectSortField} accentColor={ACCENT} />
                  <View style={styles.menuRule} />
                  <Pressable
                    style={styles.menuRow}
                    onPress={() => {
                      setMenuOpen(false);
                      toggleSelectMode();
                    }}
                  >
                    <Ionicons
                      name={isSelectMode ? 'close-outline' : 'checkmark-circle-outline'}
                      size={17}
                      color={GLASS_TEXT}
                    />
                    <Text style={styles.menuRowLabel}>{isSelectMode ? 'Скасувати вибір' : 'Вибрати'}</Text>
                  </Pressable>
                </ScrollView>
              </View>
            )}
            <View style={styles.sideIsland}>
              <BlurView
                intensity={60}
                tint="dark"
                blurMethod="dimezisBlurView"
                blurTarget={blurTarget ?? undefined}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <Pressable
                hitSlop={8}
                onPress={() => {
                  setSearchOpen((v) => !v);
                  setSearchText('');
                }}
              >
                <Ionicons name={searchOpen ? 'close-outline' : 'search-outline'} size={24} color="#fff" />
              </Pressable>
              <View style={styles.sideIslandDivider} />
              <Pressable hitSlop={8} onPress={() => setMenuOpen((v) => !v)}>
                <Ionicons name="ellipsis-horizontal-outline" size={24} color="#fff" />
              </Pressable>
            </View>
          </View>
        </View>
        </GlassPortal>
        )}

        {/* The tabs and the filter chips float over the list rather than
            standing above it, so a card slides under them and off the top
            of the screen instead of being cut short by a bar - which is
            also what finally gives the pills something to blur. Through
            the portal for the same reason as the island: a blur cannot
            live inside the view it blurs. */}
        {isFocused && !(isTwoPane && !!openDoc && paneFullscreen) && (
        <GlassPortal>
        <View
          style={[styles.topChrome, { top: chromeTop, left: paneRect.x, width: paneRect.width }]}
          pointerEvents="box-none"
          onLayout={(e) => setChromeHeight(e.nativeEvent.layout.height)}
        >
          {searchOpen && (
            <View style={styles.searchRow}>
              <BlurView
                intensity={60}
                tint="dark"
                blurMethod="dimezisBlurView"
                blurTarget={blurTarget ?? undefined}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <Ionicons name="search-outline" size={19} color={GLASS_TEXT_MUTED} />
              <TextInput
                autoFocus
                value={searchText}
                onChangeText={setSearchText}
                placeholder="Пошук документів"
                placeholderTextColor={GLASS_TEXT_FAINT}
                style={styles.searchInput}
              />
              {searchText.length > 0 && (
                <Pressable hitSlop={8} onPress={() => setSearchText('')}>
                  <Ionicons name="close-outline" size={19} color={GLASS_TEXT_MUTED} />
                </Pressable>
              )}
            </View>
          )}
          {groups.length > 0 && !groupsRowHidden && (
            // No TabsTunnel here any more: it drew a capsule blending
            // scrolled-off pills into whatever sat beside them in the row
            // - the control capsule, before it moved to the rail. Alone in
            // its own row now, the tunnel was just a stray oval floating
            // at the row's right edge with nothing to blend into.
            <View style={styles.groupsRow}>
              <ProjectTabsRow
                items={groups}
                selected={groupFilter}
                onSelect={setGroupFilter}
                unassignedLabel="Без групи"
                pinnedTab={{ id: STICKERS_GROUP, label: 'Стікери' }}
                dark
                blurTarget={blurTarget}
                endPadding={RAIL_CLEARANCE}
              />
            </View>
          )}
          {activeFilter && (
            <View style={styles.filterRow}>
              {activeFilter.type === 'untagged' ? (
                <View style={[styles.filterChip, { borderColor: '#6B7280' }]}>
                  <Ionicons name="pricetag-outline" size={13} color="#6B7280" />
                  <Text style={[styles.filterChipLabel, { color: '#6B7280' }]}>Без тегів</Text>
                  <Pressable hitSlop={8} onPress={() => setActiveFilter(null)}>
                    <Ionicons name="close-outline" size={14} color="#6B7280" />
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
                        <Ionicons name="close-outline" size={14} color={tag.color} />
                      </Pressable>
                    </View>
                  );
                })
              )}
            </View>
          )}
        </View>
        </GlassPortal>
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

        {searching ? (
          searchMatches.length === 0 ? (
            <View style={[styles.emptyState, { paddingTop: chromeBottom }]}>
              <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
            </View>
          ) : (
            <FlatList
              key={`search-${viewMode}`}
              data={searchMatches}
              keyExtractor={(item) => item.id}
              numColumns={viewMode === 'grid' ? 2 : 1}
              columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
              contentContainerStyle={[styles.list, { paddingTop: chromeBottom, paddingBottom: listBottomPad }]}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                // The title's match wins; only when the hit is in the body
                // does the card show the snippet around it instead.
                const titleMatch = findTitleMatch(item.title ?? '', needle);
                const bodyMatch = titleMatch ? null : findBodyMatch(item.blocks, needle);
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
                    titleMatch={titleMatch}
                    bodyMatch={bodyMatch}
                    onPress={() => openDocument(item.id)}
                    layout={viewMode}
                  />
                );
              }}
            />
          )
        ) : showingStickers ? (
          freeStickers.length === 0 ? (
            <View style={[styles.emptyState, { paddingTop: chromeBottom }]}>
              <Text style={styles.emptyLabel}>Немає вільних стікерів</Text>
            </View>
          ) : (
            <FlatList
              key={`stickers-${viewMode}`}
              data={freeStickers}
              keyExtractor={(item) => item.id}
              numColumns={viewMode === 'grid' ? 2 : 1}
              columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
              contentContainerStyle={[styles.list, { paddingTop: chromeBottom, paddingBottom: listBottomPad }]}
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.stickerCard,
                    viewMode === 'grid' ? styles.stickerCardGrid : styles.stickerCardRow,
                  ]}
                  onPress={() => openFreeSticker(item)}
                >
                  {stickerFace(item)}
                </Pressable>
              )}
            />
          )
        ) : isLoading ? (
          <View style={[styles.emptyState, { paddingTop: chromeBottom }]}>
            <ActivityIndicator color={ACCENT} />
          </View>
        ) : displayedDocuments.length === 0 ? (
          <View style={[styles.emptyState, { paddingTop: chromeBottom }]}>
            {documents.length === 0 ? (
              <>
                <Pressable style={styles.emptyIcon} onPress={createDocument}>
                  <Ionicons name="document-text-outline" size={32} color={ACCENT} />
                  <View style={styles.emptyBadge}>
                    <Ionicons name="add-outline" size={14} color="#fff" />
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
            // The cards start below the floating tabs and scroll up under
            // them from there.
            contentContainerStyle={[styles.list, { paddingTop: chromeBottom, paddingBottom: listBottomPad }]}
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

        {/* Through the portal, like the rest of the rail: the blur that
            fills it has to sit outside the view it blurs. */}
        {isFocused && !isSelectMode && !(isTwoPane && !!openDoc && paneFullscreen) && (
        <GlassPortal>
          <Pressable
            style={[styles.fab, { bottom: rail.addBottom }, fabPressed && styles.fabSticker]}
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
            <BlurView
              intensity={60}
              tint="dark"
              blurMethod="dimezisBlurView"
              blurTarget={blurTarget ?? undefined}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <Ionicons name="add-outline" size={28} color={fabPressed ? STICKER_DARK : '#fff'} />
          </Pressable>
        </GlassPortal>
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
                onClose={() => {
                  setOpenDoc(null);
                  setPaneFullscreen(false);
                }}
                isFullscreen={paneFullscreen}
                onToggleFullscreen={() => setPaneFullscreen((v) => !v)}
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

      <TagsDrawer
        tags={drawerTags}
        activeFilter={activeFilter}
        onSelectFilter={setActiveFilter}
        hideOpenButton={isSelectMode}
        groupSection={{
          // The same list the tabs show, sentinels and all, so the two
          // never disagree about what there is to pick.
          items: [
            { id: null, name: 'Всі', color: GLASS_TEXT_MUTED },
            ...groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
            { id: UNASSIGNED_ID, name: 'Без групи', color: GLASS_TEXT_MUTED },
            { id: STICKERS_GROUP, name: 'Стікери', color: STICKER_YELLOW },
          ],
          selected: groupFilter,
          onSelect: setGroupFilter,
          rowVisible: !groupsRowHidden,
          onToggleRow: toggleGroupsRow,
        }}
      />

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
  paneHidden: {
    display: 'none',
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
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.5)',
  },
  // The capsule, stood on its end against the right edge. A full-height
  // layer rather than a `top: 50%` offset, so it centres itself without
  // knowing how tall it is; box-none keeps the empty column above and
  // below it from swallowing taps meant for the list.
  sideIslandLayer: {
    position: 'absolute',
    // `top`, `left` and `width` come from the pane's own layout - on a
    // Fold the capsule hugs the list's pane, not the window. It stands
    // part way over the group tabs' band rather than below it: the tabs
    // keep the rail's width clear, and hanging it all the way under them
    // left the rail without the height to fit its four pieces.
    // Android keeps ~20px at each edge for its own back gesture, so it
    // sits a little in from the edge rather than against it.
    alignItems: 'flex-end',
    paddingRight: 14,
    // Above the menu's backdrop (5), so the "..." button can also close
    // the menu it opened.
    zIndex: 6,
  },
  // The band the group tabs and the tag chips float in, over the list.
  topChrome: {
    position: 'absolute',
    zIndex: 6,
  },
  sideIslandRow: {
    flexDirection: 'row',
    // Top-aligned, not centred: the menu is taller than the capsule, and
    // centring it would hang it off the top of the screen.
    alignItems: 'flex-start',
    gap: 8,
  },
  sideIsland: {
    alignItems: 'center',
    gap: 18,
    paddingVertical: 18,
    // As wide as the navigation island is thick: 19 + a 24px icon + 19,
    // inside a 1px border on each side.
    paddingHorizontal: 19,
    borderRadius: 999,
    // The blur fills this view; overflow keeps it inside the rounded
    // shape, so the edge stays a clean line instead of being smeared out
    // with everything else.
    overflow: 'hidden',
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  // The divider turns with the capsule: a short rule across it, not down it.
  sideIslandDivider: {
    width: 20,
    height: 1,
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
  // Sits in the island's own row now, so it needs no coordinates of its
  // own - it opens level with the button that opened it, in the island's
  // own glass rather than the near-solid dark it used to be: with the
  // blur behind it, that darkness isn't needed to stay readable.
  menuPanel: {
    width: 200,
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  menuRule: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginVertical: 6,
  },
  menuScroll: {
    padding: 6,
  },
  menuSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    letterSpacing: 0.04,
    textTransform: 'uppercase',
    color: GLASS_TEXT_FAINT,
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
    color: GLASS_TEXT,
  },
  gridRow: {
    gap: 12,
    paddingHorizontal: 20,
  },
  // The field, in the same glass as the pills under it. Stops short of the
  // rail, like they do.
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 45,
    marginLeft: 20,
    marginRight: RAIL_CLEARANCE,
    marginBottom: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
    padding: 0,
  },
  // Still a row even though the capsule has left it: TabsTunnel's inner
  // `flex: 1` only means "the rest of the width" inside a row.
  groupsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 6,
  },
  // Without flexGrow/flexShrink: 0, this horizontal ScrollView competes for
  // height with the documents FlatList below it and gets squeezed shorter
  // than its own content (150px cards clipped) - same bug/fix as
  // ProjectTabsRow's own `scroll` style documents.
  stickerCard: {
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
  // Two to a row in grid view, one across in list view - the same two
  // shapes the document cards take.
  stickerCardGrid: {
    flex: 1,
    height: 180,
    marginBottom: 12,
  },
  stickerCardRow: {
    height: 120,
    marginHorizontal: 20,
    marginBottom: 12,
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
    fontFamily: FONT_MEDIUM,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingLeft: 20,
    // Clear of the capsule, which stands level with this band now.
    paddingRight: RAIL_CLEARANCE,
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
    // paddingBottom comes from listBottomPad - it depends on the window
    // size and the tag/add buttons' own spread, not a fixed number.
  },
  // The square the halo is drawn on: twice the button across, centred on
  // it, because the button's own box would clip the light.
  // Glass like everything else on the rail, in its own colour rather than
  // a solid disc with a light around it: the blur is what separates it
  // from the cards underneath, so the fill only has to tint.
  fab: {
    position: 'absolute',
    right: RAIL_RIGHT,
    width: RAIL_WIDTH,
    height: RAIL_WIDTH,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: ACCENT_GLASS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  // Long-pressing the FAB switches it to sticker-creation mode - the color
  // swap away from ACCENT is the only feedback the gesture has fired,
  // since it fires while still held rather than on release.
  fabSticker: {
    backgroundColor: STICKER_GLASS,
  },
});
