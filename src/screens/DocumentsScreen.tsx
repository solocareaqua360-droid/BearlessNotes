import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
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
import AttachmentImage from '../components/AttachmentImage';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { RouteProp, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  query,
  updateDoc,
  writeBatch,
} from '../firestore';
import { addDoc, ownedQuery, setDoc } from '../utils/owned';
import { GLASS_ISLAND, GLASS_TEXT, GLASS_TEXT_FAINT, GLASS_TEXT_MUTED } from '../constants/glass';
import { BackHandler } from 'react-native';
import { db } from '../firebase';
import { DocumentItem, SketchElement, Tag } from '../types';
import RenamePrompt from '../components/RenamePrompt';
import { TAG_COLORS } from '../constants/tags';
import { hapticButtonDown, hapticButtonUp } from '../utils/haptics';
import { RootStackParamList } from '../navigation';
import { detachTagFromDeletedItem, ITEMS_COLLECTION_BY_KIND } from '../hooks/useTags';
import { useDatabaseList } from '../hooks/useDatabaseList';
import { applyLiveRecord, useLiveRecords } from '../hooks/useLiveRecords';
import { pullHaptic, useKeyboardVisible, usePullToSearch, useSearchDismissal } from '../hooks/usePullToSearch';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import DocumentEditorScreen from './DocumentEditorScreen';
import { FIELD_ICONS, FIELD_LABELS, FIELD_ORDER } from '../components/SortMenuRows';
import RailCapsule from '../components/RailCapsule';
import SearchField from '../components/SearchField';
import ScreenBackdrop from '../components/ScreenBackdrop';
import Menu from '../components/surfaces/Menu';
import TagsDrawer, { TagsDrawerHandle, removeTagFromFilter, useDrawerSwipe } from '../components/TagsDrawer';
import ProjectTabsRow, { UNASSIGNED_ID } from '../components/ProjectTabsRow';
import GroupPickerSheet from '../components/GroupPickerSheet';
import TagPicker from '../components/TagPicker';
import BulkActionBar from '../components/BulkActionBar';
import DocumentCard from '../components/DocumentCard';
import GroupSections from '../components/GroupSections';
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
import { CAPSULE_DROP, CAPSULE_HEIGHT, CAPSULE_HEIGHT_1, CAPSULE_HEIGHT_3, CAPSULE_HEIGHT_4, CHROME_TOP, NAV_HEIGHT, RAIL_CLEARANCE, RAIL_GAP, RAIL_RIGHT, RAIL_WIDTH, railFits } from '../constants/rail';
import { useRail, useRailFree } from '../hooks/useRail';
import { useBlurTarget } from '../components/GlassTarget';
import { ask, confirm, notify } from '../components/surfaces/Ask';
import TagEditSheet from '../components/TagEditSheet';

// Палітра №3 (Теплий Теракотовий) - the create/edit action color across
// this redesign; replaces the old blue ACCENT wherever this screen used it.
const ACCENT = '#BE7657';
const documentsCollection = collection(db, 'documents');
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


type StripSticker = {
  id: string;
  type: 'paragraph' | 'image' | 'sketch';
  text?: string;
  imageUri?: string;
  // Where the picture's bytes are when the path above is not here - a
  // browser, or another phone. See AttachmentImage.
  driveFileId?: string;
  sketchElements?: SketchElement[];
  sketchWidth?: number;
  sketchHeight?: number;
  usedInDocuments?: Record<string, true>;
  trashed?: boolean;
};

export default function DocumentsScreen({
  inPane,
  // A copy pushed over the tile board: it has a way back and no island.
  standalone,
}: { inPane?: boolean; standalone?: boolean } = {}) {
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
  const responsive = useResponsiveLayout();
  const { width: layoutWidth, height: layoutHeight } = responsive;
  // Drawn INSIDE another screen's pane (the tile board opens every
  // database there now), where there is no room to split again - so the
  // list is the whole of this screen and a tapped document is pushed,
  // exactly as on a phone.
  const isTwoPane = responsive.isTwoPane && !inPane;
  // Drawn in another screen's LEFT pane, the window's outer edge is the
  // left one - so the rail stands there instead of against the divider in
  // the middle of the screen, where it would be in the way of both halves.
  const railSide = inPane ? ('left' as const) : ('right' as const);
  // Which side the rows keep clear of, since it is the side the rail is on.
  const listClear =
    railSide === 'left'
      ? { paddingLeft: RAIL_CLEARANCE - 20, paddingRight: 0 }
      : null;
  // The document pane taking the whole window. Only reachable from the
  // editor's own header, and only while there are two panes to collapse.
  const [paneFullscreen, setPaneFullscreen] = useState(false);
  // Which document the right-hand pane holds. Only ever read in two-pane
  // mode; on a phone a document is a pushed screen, as before.
  const [openDoc, setOpenDoc] = useState<{ id: string; autoFocusTitle?: boolean } | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const liveRecords = useLiveRecords(documents.length > 0);
  const [isLoading, setIsLoading] = useState(true);
  // The machine every database screen shares - see useDatabaseList. This
  // screen keeps its own chrome (the two panes, the glass menu, the
  // stickers tab), but the records go through the same mill as everywhere
  // else.
  const list = useDatabaseList<DocumentItem>({
    prefsKey: 'documentsPrefs',
    groupKind: 'document',
    tagKind: 'document',
    items: documents,
    tagIdsOf: (d) => d.tagIds ?? [],
    groupIdOf: (d) => d.groupId,
    titleOf: (d) => d.title || 'Без назви',
    createdAtOf: (d) => d.createdAt,
    updatedAtOf: (d) => d.updatedAt,
    // A document matches on its body as well as its title, and the search
    // reaches every one of them rather than only what the filters left.
    matchesSearch: (d, needle) => documentMatchesQuery(d.title ?? '', d.blocks, needle),
    searchIgnoresFilters: true,
  });
  const {
    tags,
    attachTag,
    detachTag,
    createAndAttachTag,
    renameTag,
    isSelectMode,
    selectedIds,
    toggleSelectMode,
    toggle: toggleSelected,
    clear: clearSelection,
    sortPref,
    selectSortField,
    groups,
    groupFilter,
    setGroupFilter,
    tagFilter: activeFilter,
    setTagFilter: setActiveFilter,
    isSearching: searchOpen,
    setIsSearching: setSearchOpen,
    searchQuery: searchText,
    setSearchQuery: setSearchText,
    groupsRowHidden,
    viewMode,
    changeViewMode,
    drawerTags,
    explorerMode,
    listMode,
    setListMode,
    displayed: displayedDocuments,
    selected: selectedDocuments,
    needle,
  } = list;
  const searching = searchOpen && needle.length > 0;
  // The drawer opens on a swipe to the right across the list - see
  // useDrawerSwipe; the folder button is gone.
  const drawerRef = useRef<TagsDrawerHandle>(null);
  const drawerSwipe = useDrawerSwipe(useCallback(() => drawerRef.current?.open(), []));

  // «Провідник» - the folders in the list itself, one level at a time.
  //
  // A folder is a segment of a tag's path ("робота/оренда" is the folder
  // "робота" holding the folder "оренда"), so the tree is read straight
  // off the tags; nothing is stored for it. What a level shows is the
  // file manager's answer: the folders directly under it, and the
  // documents tagged with exactly this path - not with anything deeper,
  // which is what the next folder is for. At the root, the documents
  // that carry no tag at all.
  const [explorerPath, setExplorerPathState] = useState('');
  // Where you have been, for the rail's back/forward: a plain history like
  // a browser's. Going somewhere new cuts off whatever was "forward";
  // back and forward only move along what is there, and do nothing at
  // either end - the user's rule: forward into a folder you have not
  // been to is no action at all.
  const historyRef = useRef<{ paths: string[]; index: number }>({ paths: [''], index: 0 });
  const [historyState, setHistoryState] = useState({ canBack: false, canForward: false });
  function syncHistoryState() {
    const h = historyRef.current;
    setHistoryState({ canBack: h.index > 0, canForward: h.index < h.paths.length - 1 });
  }
  function setExplorerPath(next: string | ((prev: string) => string)) {
    const h = historyRef.current;
    const path = typeof next === 'function' ? next(h.paths[h.index]) : next;
    if (path === h.paths[h.index]) return;
    h.paths = [...h.paths.slice(0, h.index + 1), path];
    h.index = h.paths.length - 1;
    setExplorerPathState(path);
    syncHistoryState();
  }
  function explorerBack() {
    const h = historyRef.current;
    if (h.index === 0) return;
    h.index -= 1;
    setExplorerPathState(h.paths[h.index]);
    syncHistoryState();
  }
  function explorerForward() {
    const h = historyRef.current;
    if (h.index >= h.paths.length - 1) return;
    h.index += 1;
    setExplorerPathState(h.paths[h.index]);
    syncHistoryState();
  }
  const explorer = explorerMode && !searching;
  // The folders the explorer knows: every document tag, including one
  // made on purpose and still empty (Tag.keep) - which the drawer's own
  // list leaves out, since in the ordinary mode an empty folder is not a
  // folder. That is the user's rule for the two modes.
  const explorerTags = tags.filter((t) => t.types.includes('document') || drawerTags.some((d) => d.id === t.id));
  const tagByPath = new Map(explorerTags.map((t) => [t.path, t]));
  type Folder = { name: string; fullPath: string; tag: Tag | undefined; count: number; docs: number; subfolders: number };
  // What the two small numbers on a folder say: the documents directly in
  // it (not in its sub-folders), and the sub-folders directly in it.
  function directDocs(fullPath: string): number {
    const own = tagByPath.get(fullPath);
    return own ? documents.filter((d) => (d.tagIds ?? []).includes(own.id)).length : 0;
  }
  function directSubfolders(fullPath: string): number {
    const prefix = `${fullPath}/`;
    return new Set(explorerTags.filter((t) => t.path.startsWith(prefix)).map((t) => t.path.slice(prefix.length).split('/')[0])).size;
  }
  function countInside(fullPath: string): number {
    const inside = new Set(
      explorerTags.filter((t) => t.path === fullPath || t.path.startsWith(`${fullPath}/`)).map((t) => t.id)
    );
    return documents.filter((d) => (d.tagIds ?? []).some((id) => inside.has(id))).length;
  }
  const explorerFolders: Folder[] = (() => {
    if (!explorerMode) return [];
    // Searching: every folder whose name has the words, from the whole
    // tree, shown with its path - a search that found the documents but
    // not the folders would be half a search.
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
    const prefix = explorerPath ? `${explorerPath}/` : '';
    const seen = new Map<string, Folder>();
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
    // What a folder's number says: every document anywhere under it,
    // which is what a file manager's "items" means for a folder.
    for (const folder of seen.values()) folder.count = countInside(folder.fullPath);
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();
  const explorerDocuments = !explorer
    ? displayedDocuments
    : explorerPath === ''
      ? displayedDocuments.filter((d) => (d.tagIds ?? []).every((id) => !explorerTags.some((t) => t.id === id)))
      : displayedDocuments.filter((d) => {
          const here = tagByPath.get(explorerPath);
          return !!here && (d.tagIds ?? []).includes(here.id);
        });
  // A folder made here, in the level being looked at. Held "+" does it
  // (a tap makes a document, as always); a folder made this way is kept
  // while empty - see createFolderTag.
  // One prompt for every folder name: a new folder in some parent, or a
  // folder's new name.
  const [folderPrompt, setFolderPrompt] = useState<{ mode: 'new'; parent: string } | { mode: 'rename'; path: string } | null>(null);
  const [folderEdit, setFolderEdit] = useState<Tag | null>(null);
  const [docRename, setDocRename] = useState<DocumentItem | null>(null);
  const randomColor = () => TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
  const cleanName = (name: string) => name.trim().replace(/\//g, ' ');
  const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');
  const nameOf = (path: string) => path.split('/').pop() ?? path;
  // Every folder path the tree has, whether or not a tag sits on it (a
  // folder can be only a segment of a deeper tag's path).
  const allFolderPaths = Array.from(
    new Set(
      explorerTags.flatMap((t) => {
        const parts = t.path.split('/');
        return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
      })
    )
  ).sort();
  // The tag that stands for a folder, made if the folder was only a path
  // segment until now - a document can only be put IN a folder that is a
  // tag.
  async function tagForFolder(path: string): Promise<Tag> {
    const existing = tagByPath.get(path);
    if (existing) return existing;
    const id = await list.createFolderTag(path, 'document', randomColor());
    return { id, path, icon: 'folder-outline', color: TAG_COLORS[0], types: ['document'], usedIn: {}, keep: true };
  }
  // A folder's path changes, and every path under it follows.
  async function renameFolder(oldPath: string, newPath: string) {
    if (oldPath === newPath || !newPath) return;
    const affected = explorerTags.filter((t) => t.path === oldPath || t.path.startsWith(`${oldPath}/`));
    await Promise.all(affected.map((t) => renameTag(t, newPath + t.path.slice(oldPath.length))));
    if (explorerPath === oldPath || explorerPath.startsWith(`${oldPath}/`)) {
      setExplorerPath(newPath + explorerPath.slice(oldPath.length));
    }
  }
  async function saveFolderName(name: string) {
    const prompt = folderPrompt;
    setFolderPrompt(null);
    const clean = cleanName(name);
    if (!prompt || !clean) return;
    if (prompt.mode === 'new') {
      const path = prompt.parent ? `${prompt.parent}/${clean}` : clean;
      if (tagByPath.has(path)) return;
      await list.createFolderTag(path, 'document', randomColor());
    } else {
      const parent = parentOf(prompt.path);
      await renameFolder(prompt.path, parent ? `${parent}/${clean}` : clean);
    }
  }
  // Deleting a folder is unpacking it: what was inside goes up one level
  // - documents to the parent folder (or to no folder at the root), and
  // sub-folders lose this one segment of their path.
  async function deleteFolder(path: string) {
    const yes = await confirm({
      title: `Видалити папку «${nameOf(path)}»?`,
      message: 'Документи й підпапки з неї піднімуться на рівень вище.',
      confirmLabel: 'Видалити',
    });
    if (!yes) return;
    const parent = parentOf(path);
    const own = tagByPath.get(path);
    if (own) {
      const holders = documents.filter((d) => (d.tagIds ?? []).includes(own.id));
      if (parent) {
        const parentTag = await tagForFolder(parent);
        await Promise.all(holders.map((d) => attachTag(parentTag, 'document', d.id, ITEMS_COLLECTION_BY_KIND.document)));
      }
      await list.deleteTagCompletely(own);
    }
    const below = explorerTags.filter((t) => t.path.startsWith(`${path}/`));
    await Promise.all(
      below.map((t) => {
        const rest = t.path.slice(path.length + 1);
        return renameTag(t, parent ? `${parent}/${rest}` : rest);
      })
    );
    if (explorerPath === path || explorerPath.startsWith(`${path}/`)) setExplorerPath(parent);
  }
  // Where a folder or a document could go: the root, and every folder but
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
    return choice === '/' ? null : choice.slice(2);
  }
  // Held down on a folder row.
  async function openFolderMenu(folder: { fullPath: string; tag: Tag | undefined }) {
    const path = folder.fullPath;
    const choice = await ask({
      title: nameOf(path),
      actions: [
        { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' },
        { id: 'look', label: 'Іконка й колір', icon: 'color-palette-outline' },
        { id: 'sub', label: 'Нова підпапка', icon: 'folder-open-outline' },
        { id: 'move', label: 'Перемістити в…', icon: 'arrow-forward-outline' },
        { id: 'delete', label: 'Видалити', icon: 'trash-outline', tone: 'danger' },
      ],
    });
    if (choice === 'rename') setFolderPrompt({ mode: 'rename', path });
    else if (choice === 'look') setFolderEdit(await tagForFolder(path));
    else if (choice === 'sub') setFolderPrompt({ mode: 'new', parent: path });
    else if (choice === 'move') {
      const dest = await pickDestination(`Перемістити «${nameOf(path)}» в…`, path);
      if (dest === 'cancel') return;
      await renameFolder(path, dest ? `${dest}/${nameOf(path)}` : nameOf(path));
    } else if (choice === 'delete') deleteFolder(path);
  }
  // Held down on a document card, anywhere in the list.
  async function openDocumentMenu(item: DocumentItem) {
    const choice = await ask({
      title: item.title || 'Без назви',
      actions: [
        { id: 'move', label: 'Перемістити в…', icon: 'arrow-forward-outline' },
        { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' },
        { id: 'bin', label: 'У кошик', icon: 'trash-outline', tone: 'danger' },
      ],
    });
    if (choice === 'rename') setDocRename(item);
    else if (choice === 'bin') confirmDeleteDocument(item.id);
    else if (choice === 'move') {
      const dest = await pickDestination(`Перемістити «${item.title || 'Без назви'}» в…`);
      if (dest === 'cancel') return;
      // Moving means ONE folder from now on: the document leaves every
      // folder it was in and enters the chosen one.
      const current = explorerTags.filter((t) => (item.tagIds ?? []).includes(t.id));
      await Promise.all(current.map((t) => detachTag(t, 'document', item.id, ITEMS_COLLECTION_BY_KIND.document)));
      if (dest) {
        const target = await tagForFolder(dest);
        await attachTag(target, 'document', item.id, ITEMS_COLLECTION_BY_KIND.document);
      }
    }
  }
  // Up one level. On Android the system's back does it too while there is
  // a level to go up to - a file manager that closed on "back" would be
  // no file manager.
  function explorerUp() {
    setExplorerPath((p) => p.split('/').slice(0, -1).join('/'));
  }
  // The path strip: every level between the root and here, each a
  // button. It scrolls sideways rather than wrapping, and turns to its
  // end whenever the level changes, so where you are is always in view;
  // past four levels the middle folds into "…", which a tap unfolds.
  const crumbScrollRef = useRef<ScrollView | null>(null);
  const [crumbsUnfolded, setCrumbsUnfolded] = useState(false);
  useEffect(() => {
    setCrumbsUnfolded(false);
    const t = setTimeout(() => crumbScrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [explorerPath]);
  const crumbSegments = explorerPath ? explorerPath.split('/') : [];
  const crumbFolded = !crumbsUnfolded && crumbSegments.length > 3;
  useEffect(() => {
    if (!explorer || explorerPath === '') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      explorerUp();
      return true;
    });
    return () => sub.remove();
  }, [explorer, explorerPath]);
  // Changing the mode puts the other modes' filters down: a group chosen
  // under "Групи" must not keep narrowing the list under "Список", where
  // nothing shows that it does. The explorer starts at its root.
  useEffect(() => {
    if (listMode !== 'groups' && groupFilter !== STICKERS_GROUP) setGroupFilter(null);
    if (listMode !== 'list') setActiveFilter(null);
    if (listMode === 'explorer') {
      historyRef.current = { paths: [''], index: 0 };
      setExplorerPathState('');
      syncHistoryState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listMode]);
  // The screen clears itself only while the search is actually being
  // typed; with the keyboard down the buttons come back and the field is
  // one control among them again.
  const keyboardUp = useKeyboardVisible();
  const searchingAlone = searchOpen && keyboardUp;
  const [bulkTagPickerVisible, setBulkTagPickerVisible] = useState(false);
  const [bulkGroupPickerVisible, setBulkGroupPickerVisible] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [freeStickers, setFreeStickers] = useState<StripSticker[]>([]);
  const [stickerComposerVisible, setStickerComposerVisible] = useState(false);
  const [editingTextSticker, setEditingTextSticker] = useState<{ id: string; text: string } | null>(null);
  // The uri and its Drive copy together - see AttachmentImage.
  const [viewerImageUri, setViewerImageUri] = useState<{ uri: string; driveFileId?: string } | null>(null);
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
  // Where the open document's own pane starts - what its rail stands in
  // from, on the left.
  const [editorPaneLeft, setEditorPaneLeft] = useState(0);
  // How many cards stand across the list, and how many folders.
  //
  // Two on a phone, as always. On the Fold's inner screen with no
  // document open the list has the whole width, and the user said what to
  // do with it: four cards across it lying down, three standing up - and
  // the folders, which are wide rows rather than cards, pair up only when
  // there is room for four cards beside them.
  const wideList = isTwoPane && !openDoc;
  // With a document open beside it the list is half a screen wide, and
  // the user's call is one card to a line there, not two squeezed ones.
  const gridColumns = wideList ? (layoutWidth > layoutHeight ? 4 : 3) : 2;
  // Two folders to a line whenever the list has the whole inner screen,
  // standing up as well as lying down - the user's call once the rows
  // lined up. A folder row is an icon, a name and two small numbers, and
  // half the inner screen is plenty for that.
  const folderColumns = wideList ? 2 : 1;
  // What the list actually draws. With a document open beside it the list
  // is half a screen wide, and one card to a line there is the LIST row -
  // not a grid of one column: the grid card is a fixed-height tile, and a
  // FlatList refuses columnWrapperStyle on a single column outright,
  // which is what the white screen was.
  const drawnMode: 'list' | 'grid' = viewMode === 'grid' && isTwoPane && !!openDoc ? 'list' : viewMode;
  // Widths in PIXELS, from the width the list actually has, so a row of
  // cards ends on the same line as a row of folders above it. As
  // percentages the two could not agree: the gaps between cards are
  // pixels, so the percentage had to leave slack for them, and the slack
  // came out on the right as a ragged edge against the folders.
  //
  // What the rows actually have: the pane, less the list's own clearance
  // from the rail on the right, less the 20 each row keeps on either side.
  // Worked out from the pane alone it came to more than that, so two
  // folders would not fit a line and fell one under the other, leaving
  // the right half empty - while four cards did fit, by running under the
  // rail.
  const listWidth = (paneRect.width || layoutWidth) - (RAIL_CLEARANCE - 20) - 40;
  const gridCardWidth = Math.floor((listWidth - 12 * (gridColumns - 1)) / gridColumns);
  const folderRowWidth = folderColumns > 1 ? Math.floor((listWidth - 10) / 2) : undefined;
  const insets = useSafeAreaInsets();
  const chromeTop = insets.top + CHROME_TOP;
  const chromeBottom = chromeTop + chromeHeight + 8;
  // The island is drawn through the portal, over the whole window, so it
  // has to withdraw when this screen isn't the one on show.
  const isFocused = useIsFocused();
  const blurTarget = useBlurTarget();
  // The rail carries an ACTIONS capsule now, a capsule's height where the
  // folder button stood - see RailCapsule.
  // In the explorer the create capsule carries a second button (a new
  // folder) and a back/forward capsule appears; elsewhere the rail is as
  // it was. The arrows are asked whether they FIT first: on the Fold
  // lying down the top capsule, the island and a tall inset leave about
  // 320 points for the three pieces, and the four of them with the arrows
  // want 340 - so they rode up over each other. The path strip does what
  // the arrows do, so they are what goes.
  // A pushed copy carries the way back as a fourth button, and has no
  // island at its foot - like every other pushed screen.
  const topCapsuleHeight = standalone ? CAPSULE_HEIGHT_4 : CAPSULE_HEIGHT_3;
  const railFree = useRailFree(topCapsuleHeight, !standalone);
  const arrowsFit = explorer && railFits(railFree, CAPSULE_HEIGHT_1, CAPSULE_HEIGHT, CAPSULE_HEIGHT);
  const rail = useRail(
    topCapsuleHeight,
    CAPSULE_HEIGHT_1,
    explorer ? CAPSULE_HEIGHT : RAIL_WIDTH,
    arrowsFit ? CAPSULE_HEIGHT : 0,
    !standalone
  );
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  // Opening the search takes the screen, so anything hanging off the rail
  // goes with it - the sort menu stayed up over the keyboard otherwise.
  useEffect(() => {
    if (searchOpen || isSelectMode) {
      setSortMenuOpen(false);
      setMenuOpen(false);
    }
  }, [searchOpen, isSelectMode]);
  // How far the list has to clear the bottom edge so its last card never
  // ends up sitting behind the navigation island - the island is the
  // tallest thing on the rail's foot and the closest to that edge.
  const listBottomPad = rail.navBottom + rail.islandHeight + RAIL_GAP;
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
    // Filtered client-side (same "avoid a composite index" tradeoff as
    // everywhere else in this app) - only stickers with nothing in
    // usedInDocuments and not trashed belong in this "free stash" strip.
    // The full "Стікери" database screen shows every sticker regardless.
    return onSnapshot(ownedQuery('stickers'), (snapshot) => {
      setFreeStickers(
        // Newest first, read off the raw data - StripSticker itself carries
        // no updatedAt, and the query no longer sorts (see ownedQuery).
        [...snapshot.docs]
          .sort((a, b) => ((b.data().updatedAt as number) ?? 0) - ((a.data().updatedAt as number) ?? 0))
          .map((d) => ({ id: d.id, ...(d.data() as Omit<StripSticker, 'id'>) }))
          .filter((s) => !s.trashed && Object.keys(s.usedInDocuments ?? {}).length === 0)
      );
    });
  }, []);

  function openStickerComposer() {
    if (freeStickers.length >= FREE_STICKER_LIMIT) {
      notify('Забагато вільних стікерів', `Спершу розмісти якийсь із наявних ${FREE_STICKER_LIMIT} стікерів у документі чи календарі, щоб звільнити місце.`);
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
      setViewerImageUri({ uri: sticker.imageUri, driveFileId: sticker.driveFileId });
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

  // The bin. A note in it is stamped deletedAt and left out of every
  // list; it keeps its tags, mirrors and arrows so that coming back is
  // coming back whole. Emptied by hand, or by time: thirty days.
  const [trashed, setTrashed] = useState<DocumentItem[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const purgedRef = useRef(new Set<string>());

  useEffect(() => {
    return onSnapshot(ownedQuery('documents'), (snapshot) => {
      const all = snapshot.docs
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
          deletedAt: docSnapshot.data().deletedAt as number | undefined,
        }))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      setDocuments(all.filter((d) => !d.deletedAt));
      const inBin = all.filter((d) => !!d.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
      setTrashed(inBin);
      // Time does the emptying nobody got round to. Once per note per
      // session, so a slow write does not get asked for twice.
      const cutoff = Date.now() - TRASH_TTL_MS;
      inBin.forEach((d) => {
        if ((d.deletedAt ?? 0) < cutoff && !purgedRef.current.has(d.id)) {
          purgedRef.current.add(d.id);
          purgeDocument(d.id).catch(() => {});
        }
      });
      setIsLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What the drawer's numbers say. Totals over everything, not over what
  // the current filter leaves standing - a count that moved as you
  // filtered would tell you nothing about where to go next.
  const drawerCounts = useMemo(() => {
    const byTag: Record<string, number> = {};
    let untagged = 0;
    for (const d of documents) {
      const ids = d.tagIds ?? [];
      if (ids.length === 0) untagged += 1;
      for (const id of ids) byTag[id] = (byTag[id] ?? 0) + 1;
    }
    return { byTag, untagged };
  }, [documents]);

  const groupCounts = useMemo(() => {
    const byGroup: Record<string, number> = {};
    let ungrouped = 0;
    for (const d of documents) {
      if (d.groupId) byGroup[d.groupId] = (byGroup[d.groupId] ?? 0) + 1;
      else ungrouped += 1;
    }
    return { byGroup, ungrouped };
  }, [documents]);

  // Searching replaces the list rather than narrowing it (see
  // searchIgnoresFilters) - so while a search is running, what the shared
  // list hands back IS the matches.
  const searchMatches = searching ? displayedDocuments : [];

  // A group pinned to the tile board opens this screen already filtered to
  // it (see DatabasesScreen's pinned tiles). Applied once per arrival, and
  // then left alone - it is a starting point, not a lock.
  const route = useRoute<RouteProp<{ Документи: { groupId?: string } }, 'Документи'>>();
  const arrivedWithGroup = route.params?.groupId;
  useEffect(() => {
    if (arrivedWithGroup) setGroupFilter(arrivedWithGroup);
  }, [arrivedWithGroup, setGroupFilter]);
  // Pulled down from the top of the list, the search comes out - see
  // usePullToSearch.
  const pull = usePullToSearch(() => {
    pullHaptic();
    setSearchOpen(true);
  });
  useSearchDismissal({
    isSearching: searchOpen,
    query: searchText,
    isFocused,
    close: () => {
      setSearchOpen(false);
      setSearchText('');
    },
  });

  // The stickers' tab isn't a filter over the documents - it replaces
  // them.
  const showingStickers = groupFilter === STICKERS_GROUP;

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
    // A note made INSIDE a folder belongs to that folder. Without this it
    // was created at the root and vanished from the list the moment it
    // appeared - the user was standing in the folder and the note was
    // not. A folder is a tag (see tagForFolder), so joining one is
    // carrying its tag; a folder that was only a segment of a deeper
    // path becomes a real tag here, as it does anywhere else a record is
    // put into it.
    if (list.explorerMode && explorerPath !== '') {
      const folder = await tagForFolder(explorerPath);
      await attachTag(folder, 'document', newDoc.id, ITEMS_COLLECTION_BY_KIND.document);
    }
    openDocument(newDoc.id, true);
  }

  // "Delete" puts a note in the bin. Everything it carries stays with it
  // - see DocumentItem.deletedAt.
  async function confirmDeleteDocument(id: string) {
    await updateDoc(doc(db, 'documents', id), { deletedAt: Date.now() });
  }

  // Gone for good: what deleting used to be. The tags it carried forget
  // it; the note itself is removed.
  async function purgeDocument(id: string) {
    const snapshot = await getDoc(doc(db, 'documents', id));
    if (!snapshot.exists()) return;
    const docTagIds: string[] = snapshot.data()?.tagIds ?? [];
    deleteDoc(doc(db, 'documents', id));
    await Promise.all(
      docTagIds.map((tagId) => {
        const tag = tags.find((t) => t.id === tagId);
        return tag ? detachTagFromDeletedItem(tag, 'document', id) : Promise.resolve();
      })
    );
  }

  async function restoreDocument(id: string) {
    await updateDoc(doc(db, 'documents', id), { deletedAt: deleteField() });
  }

  // Held down in the bin: back, or away for good.
  async function openTrashMenu(item: DocumentItem) {
    const choice = await ask({
      title: item.title || 'Без назви',
      actions: [
        { id: 'restore', label: 'Відновити', icon: 'arrow-undo-outline', tone: 'primary' },
        { id: 'purge', label: 'Видалити назавжди', icon: 'trash-outline', tone: 'danger' },
      ],
    });
    if (choice === 'restore') restoreDocument(item.id);
    if (choice === 'purge') purgeDocument(item.id);
  }

  async function emptyTrash() {
    const yes = await confirm({
      title: `Очистити кошик (${trashed.length})?`,
      message: 'Ці нотатки буде видалено назавжди.',
      confirmLabel: 'Очистити',
    });
    if (!yes) return;
    await Promise.all(trashed.map((d) => purgeDocument(d.id)));
  }

  function confirmDeleteSelected() {
    const toDelete = selectedDocuments;
    confirm({
      title: toDelete.length === 1 ? 'У кошик?' : `У кошик (${toDelete.length})?`,
      message: 'Можна буде повернути з кошика протягом 30 днів.',
      confirmLabel: 'У кошик',
    }).then(async (yes) => {
      if (!yes) return;
      await Promise.all(toDelete.map((d) => confirmDeleteDocument(d.id)));
      clearSelection();
    });
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
          <AttachmentImage uri={s.imageUri} driveFileId={s.driveFileId} style={styles.stickerCardImage} />
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
      <ScreenBackdrop id="documentsBg" colors={['#705648', '#69736E', '#000000']} scrollY={pull.scrollY} />

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
        {isFocused && !searchingAlone && !(isTwoPane && !!openDoc && paneFullscreen) && (
        <GlassPortal>
        <View
          style={[
            styles.sideIslandLayer,
            // A fixed line, NOT the list's own top: tied to that, the
            // capsule jumped up with the cards every time the group row
            // was put away. Same place it would have been with the row
            // showing - which is the place that was wanted.
            { top: chromeTop + CAPSULE_DROP, left: paneRect.x, width: paneRect.width },
            // In a pane the rail stands on the window's outer edge, which
            // is the left one - so this capsule goes with the rest of it.
            railSide === 'left' && styles.sideIslandLayerLeft,
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
                  <Pressable
                    style={styles.menuRow}
                    onPress={() => {
                      setMenuOpen(false);
                      changeViewMode('list');
                    }}
                  >
                    <Ionicons name="reorder-four-outline" size={17} color={GLASS_TEXT} />
                    <Text style={styles.menuRowLabel}>Список</Text>
                    {viewMode === 'list' && <Ionicons name="checkmark-outline" size={18} color={ACCENT} />}
                  </Pressable>
                  <Pressable
                    style={styles.menuRow}
                    onPress={() => {
                      setMenuOpen(false);
                      changeViewMode('grid');
                    }}
                  >
                    <Ionicons name="grid-outline" size={17} color={GLASS_TEXT} />
                    <Text style={styles.menuRowLabel}>Сітка</Text>
                    {viewMode === 'grid' && <Ionicons name="checkmark-outline" size={18} color={ACCENT} />}
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
              {/* Sort sits with the other two ways of looking at the
                  list - search and the menu - rather than alone lower
                  down. */}
              <Pressable hitSlop={8} onPress={() => setSortMenuOpen((v) => !v)}>
                <Ionicons name="filter-outline" size={24} color="#fff" />
              </Pressable>
              <View style={styles.sideIslandDivider} />
              <Pressable hitSlop={8} onPress={() => setMenuOpen((v) => !v)}>
                <Ionicons name="ellipsis-horizontal-outline" size={24} color="#fff" />
              </Pressable>
              {/* The way out of a copy pushed over the tile board. The
                  tab's own list has nowhere to go back to and no button. */}
              {standalone && (
                <>
                  <View style={styles.sideIslandDivider} />
                  <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
                    <Ionicons name="arrow-back-outline" size={24} color="#fff" />
                  </Pressable>
                </>
              )}
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
          style={[styles.topChrome, { top: chromeTop }]}
          pointerEvents="box-none"
          onLayout={(e) => setChromeHeight(e.nativeEvent.layout.height)}
        >
          {searchOpen && (
            // Fades down into place: the pull that opens it is a slow
            // movement, and the field arriving instantly read as a jolt.
            <Animated.View entering={FadeInDown.duration(220)}>
              {/* Closes the search outright rather than only emptying it:
                  with the keyboard up this is the one control on the
                  screen, and emptying a field the user is done with only
                  leaves them somewhere they have to leave again. */}
              <SearchField
                autoFocus
                value={searchText}
                onChangeText={setSearchText}
                placeholder="Пошук документів"
                onClose={() => {
                  setSearchText('');
                  setSearchOpen(false);
                }}
                style={styles.searchRow}
              />
            </Animated.View>
          )}
          {!searchingAlone && groups.length > 0 && !groupsRowHidden && (
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
                startPadding={paneRect.x + 20}
                endPadding={RAIL_CLEARANCE}
              />
            </View>
          )}
          {!searchingAlone && activeFilter && (
            <View style={[styles.filterRow, { paddingLeft: paneRect.x + 20 }]}>
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
              <ZoomableImageViewer uri={viewerImageUri.uri} driveFileId={viewerImageUri.driveFileId} onClose={() => setViewerImageUri(null)} />
            </GestureHandlerRootView>
          </Modal>
        )}

        <SketchEditor
          visible={sketchEditing !== null}
          initialElements={sketchEditing?.sketchElements ?? []}
          onSave={saveSketchEdit}
          onClose={() => setSketchEditing(null)}
        />

        {/* An empty search is a question, not a list: the screen stays
            bare until something is typed for, and everything comes back
            when the keyboard goes (see useSearchDismissal). */}
        {searchOpen && needle.length === 0 ? (
          <View style={styles.emptySearch} />
        ) : searching ? (
          searchMatches.length === 0 ? (
            <View style={[styles.emptyState, { paddingTop: chromeBottom }]}>
              <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
            </View>
          ) : (
            <GestureDetector gesture={drawerSwipe}>
            <View style={{ flex: 1 }}>
            <GestureDetector gesture={pull.gesture}>
            <FlatList
              {...pull.listProps}
              key={`search-${drawnMode}-${gridColumns}`}
              data={searchMatches}
              keyExtractor={(item) => item.id}
              numColumns={drawnMode === 'grid' ? gridColumns : 1}
              columnWrapperStyle={drawnMode === 'grid' ? styles.gridRow : undefined}
              contentContainerStyle={[styles.list, listClear, { paddingTop: chromeBottom, paddingBottom: listBottomPad }]}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                // The title's match wins; only when the hit is in the body
                // does the card show the snippet around it instead.
                const titleMatch = findTitleMatch(item.title ?? '', needle);
                const bodyMatch = titleMatch ? null : findBodyMatch(item.blocks, needle);
                const { imageUri, imageDriveFileId, imageUris, imageDriveFileIds, previewText, checklistItems } = extractPreview(
                  // Through the records as they are NOW - a block inserted before the
                  // Drive backup existed carries no driveFileId of its own; the record
                  // does. The editor overlays the same way, and the Photos database reads
                  // the record directly, which is why a picture showed there and here
                  // stayed blank. See useLiveRecords.
                  (item.blocks ?? []).map((b) => applyLiveRecord(b, liveRecords)),
                  item.coverImageUri,
                  drawnMode === 'grid' ? EXPANDED_PREVIEW_LENGTH : undefined
                );
                return (
                  <DocumentCard
                    id={item.id}
                    title={item.title}
                    updatedAt={item.updatedAt}
                    imageUri={imageUri}
                    imageDriveFileId={imageDriveFileId}
                    imageUris={imageUris}
                    imageDriveFileIds={imageDriveFileIds}
                    previewText={previewText}
                    checklistItems={checklistItems}
                    titleMatch={titleMatch}
                    bodyMatch={bodyMatch}
                    onPress={() => openDocument(item.id)}
                    layout={drawnMode}
                    gridWidth={gridCardWidth}
                  />
                );
              }}
            />
            </GestureDetector>
            </View>
            </GestureDetector>
          )
        ) : showingStickers ? (
          freeStickers.length === 0 ? (
            <View style={[styles.emptyState, { paddingTop: chromeBottom }]}>
              <Text style={styles.emptyLabel}>Немає вільних стікерів</Text>
            </View>
          ) : (
            <FlatList
              key={`stickers-${drawnMode}-${gridColumns}`}
              data={freeStickers}
              keyExtractor={(item) => item.id}
              numColumns={drawnMode === 'grid' ? gridColumns : 1}
              columnWrapperStyle={drawnMode === 'grid' ? styles.gridRow : undefined}
              contentContainerStyle={[styles.list, listClear, { paddingTop: chromeBottom, paddingBottom: listBottomPad }]}
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.stickerCard,
                    drawnMode === 'grid' ? styles.stickerCardGrid : styles.stickerCardRow,
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
        ) : !trashOpen && explorerDocuments.length === 0 && explorerFolders.length === 0 && !(explorer && explorerPath) ? (
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
          <GestureDetector gesture={drawerSwipe}>
            <View style={{ flex: 1 }}>
            <GestureDetector gesture={pull.gesture}>
          <FlatList
            {...pull.listProps}
            // FlatList throws if numColumns changes on an already-mounted
            // instance - key forces a clean remount when switching views.
            key={`${drawnMode}-${gridColumns}-${trashOpen ? 'trash' : 'list'}`}
            data={trashOpen ? trashed : explorerDocuments}
            // The folders of this level, and the way up, above the cards.
            ListHeaderComponent={
              trashOpen ? (
                <View style={[styles.explorerHead, folderColumns > 1 && styles.explorerHeadWide]}>
                  <View style={styles.explorerCrumb}>
                    <Pressable hitSlop={8} onPress={() => setTrashOpen(false)} style={styles.crumbUp}>
                      <Ionicons name="chevron-back" size={18} color={GLASS_TEXT} />
                    </Pressable>
                    <Text style={[styles.crumbLabel, styles.crumbLabelCurrent]}>Кошик · {trashed.length}</Text>
                    <View style={{ flex: 1 }} />
                    {trashed.length > 0 && (
                      <Pressable hitSlop={8} onPress={emptyTrash} style={styles.crumbSegment}>
                        <Text style={styles.crumbLabel}>Очистити</Text>
                      </Pressable>
                    )}
                  </View>
                  <Text style={styles.trashHint}>Затисни нотатку, щоб відновити або видалити назавжди. Через 30 днів кошик очищається сам.</Text>
                </View>
              ) : explorerMode && (explorerFolders.length > 0 || (explorer && explorerPath !== '')) ? (
                <View style={[styles.explorerHead, folderColumns > 1 && styles.explorerHeadWide]}>
                  {explorer && explorerPath !== '' && (
                    <View style={[styles.explorerCrumb, folderColumns > 1 && styles.explorerCrumbWide]}>
                      <Pressable hitSlop={8} onPress={explorerUp} style={styles.crumbUp}>
                        <Ionicons name="chevron-back" size={18} color={GLASS_TEXT} />
                      </Pressable>
                      <ScrollView
                        ref={crumbScrollRef}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.crumbStrip}
                        keyboardShouldPersistTaps="handled"
                      >
                        <Pressable onPress={() => setExplorerPath('')} style={styles.crumbSegment}>
                          <Text style={styles.crumbLabel}>Всі</Text>
                        </Pressable>
                        {crumbSegments.map((segment, index) => {
                          const isLast = index === crumbSegments.length - 1;
                          const target = crumbSegments.slice(0, index + 1).join('/');
                          // The fold: with many levels the middle ones
                          // become one "…" that a tap unfolds.
                          const hidden = crumbFolded && index > 0 && index < crumbSegments.length - 2;
                          const isFoldMark = crumbFolded && index === 1;
                          if (hidden && !isFoldMark) return null;
                          return (
                            <View key={target} style={styles.crumbPair}>
                              <Ionicons name="chevron-forward" size={14} color={GLASS_TEXT_FAINT} />
                              {isFoldMark ? (
                                <Pressable onPress={() => setCrumbsUnfolded(true)} style={styles.crumbSegment}>
                                  <Text style={styles.crumbLabel}>…</Text>
                                </Pressable>
                              ) : (
                                <Pressable
                                  disabled={isLast}
                                  onPress={() => setExplorerPath(target)}
                                  style={[styles.crumbSegment, isLast && styles.crumbSegmentCurrent]}
                                >
                                  <Text style={[styles.crumbLabel, isLast && styles.crumbLabelCurrent]} numberOfLines={1}>
                                    {segment}
                                  </Text>
                                </Pressable>
                              )}
                            </View>
                          );
                        })}
                      </ScrollView>
                    </View>
                  )}
                  {/* A folder row wears the document row's clothes - the
                      same card, with the tag's icon in a frame where a
                      document shows its picture - so the two read as one
                      list. Its two small numbers: the documents directly
                      in it, and the folders directly in it. */}
                  {explorerFolders.map((folder) => (
                    <Pressable
                      key={folder.fullPath}
                      style={[styles.folderRow, folderRowWidth !== undefined && { width: folderRowWidth }]}
                      onPress={() => {
                        setExplorerPath(folder.fullPath);
                        // A folder found by searching is a place to go: the
                        // search is over once it is entered.
                        if (searching) {
                          setSearchText('');
                          setSearchOpen(false);
                        }
                      }}
                      onLongPress={() => openFolderMenu(folder)}
                    >
                      <View style={[styles.folderThumb, { borderColor: folder.tag?.color ?? GLASS_TEXT_FAINT }]}>
                        <Ionicons
                          name={(folder.tag?.icon as keyof typeof Ionicons.glyphMap) || 'folder-outline'}
                          size={26}
                          color={folder.tag?.color ?? GLASS_TEXT_MUTED}
                        />
                      </View>
                      <View style={styles.folderBody}>
                        <Text style={styles.folderName} numberOfLines={1}>
                          {folder.name}
                        </Text>
                        <View style={styles.folderMeta}>
                          <Ionicons name="document-text-outline" size={14} color={GLASS_TEXT_MUTED} />
                          <Text style={styles.folderCount}>{folder.docs}</Text>
                          <Ionicons name="folder-outline" size={14} color={GLASS_TEXT_MUTED} style={styles.folderMetaGap} />
                          <Text style={styles.folderCount}>{folder.subfolders}</Text>
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={GLASS_TEXT_FAINT} />
                    </Pressable>
                  ))}
                  {/* The bin, at the root of the explorer, after the
                      folders - where a file manager keeps it. */}
                  {explorer && explorerPath === '' && trashed.length > 0 && (
                    <Pressable
                      style={[styles.folderRow, styles.trashFolderRow, folderRowWidth !== undefined && { width: folderRowWidth }]}
                      onPress={() => setTrashOpen(true)}
                    >
                      <View style={[styles.folderThumb, { borderColor: GLASS_TEXT_FAINT }]}>
                        <Ionicons name="trash-outline" size={26} color={GLASS_TEXT_MUTED} />
                      </View>
                      <View style={styles.folderBody}>
                        <Text style={[styles.folderName, { color: GLASS_TEXT_MUTED }]}>Кошик</Text>
                        <View style={styles.folderMeta}>
                          <Ionicons name="document-text-outline" size={14} color={GLASS_TEXT_MUTED} />
                          <Text style={styles.folderCount}>{trashed.length}</Text>
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={GLASS_TEXT_FAINT} />
                    </Pressable>
                  )}
                </View>
              ) : null
            }
            keyExtractor={(item) => item.id}
            // FlatList only re-renders an already-mounted row when `data` or
            // `extraData` changes - isSelectMode/selectedIds live outside
            // `data`, so without this a card kept showing its pre-select-mode
            // props (tapping it still navigated instead of toggling a
            // checkbox) even though renderItem's own closure had the fresh
            // values.
            extraData={[isSelectMode, selectedIds]}
            // What else is in this group - see GroupSections. Only under
            // the real list: a search or the stickers tab is not a group's
            // view of itself.
            ListFooterComponent={
              <GroupSections
                groupId={list.selectedGroupId}
                currentKind="document"
                tags={tags}
                // This list pads nothing: its own cards carry their side
                // margin, so the sections have to bring the same one.
                sidePadding={20}
              />
            }
            numColumns={drawnMode === 'grid' ? gridColumns : 1}
            columnWrapperStyle={drawnMode === 'grid' ? styles.gridRow : undefined}
            // The cards start below the floating tabs and scroll up under
            // them from there.
            contentContainerStyle={[styles.list, listClear, { paddingTop: chromeBottom, paddingBottom: listBottomPad }]}
            renderItem={({ item }) => {
              // Grid cards reclaim the thumbnail's space for text when a
              // document has no image (see DocumentCard's own noImage
              // handling) - list rows are unaffected, so they keep the
              // short default length.
              const { imageUri, imageDriveFileId, imageUris, imageDriveFileIds, previewText, checklistItems } = extractPreview(
                // Through the records as they are NOW - a block inserted before the
                // Drive backup existed carries no driveFileId of its own; the record
                // does. The editor overlays the same way, and the Photos database reads
                // the record directly, which is why a picture showed there and here
                // stayed blank. See useLiveRecords.
                (item.blocks ?? []).map((b) => applyLiveRecord(b, liveRecords)),
                item.coverImageUri,
                drawnMode === 'grid' ? EXPANDED_PREVIEW_LENGTH : undefined
              );
              return (
                <DocumentCard
                  id={item.id}
                  title={item.title}
                  updatedAt={item.updatedAt}
                  imageUri={imageUri}
                  imageDriveFileId={imageDriveFileId}
                  imageUris={imageUris}
                  imageDriveFileIds={imageDriveFileIds}
                  previewText={previewText}
                  checklistItems={checklistItems}
                  onPress={() => (trashOpen ? openTrashMenu(item) : openDocument(item.id))}
                  onLongPress={() => (trashOpen ? openTrashMenu(item) : isSelectMode ? undefined : openDocumentMenu(item))}
                  isSelectMode={isSelectMode}
                  isSelected={selectedIds.has(item.id)}
                  onToggleSelect={() => toggleSelected(item.id)}
                  layout={drawnMode}
                    gridWidth={gridCardWidth}
                />
              );
            }}
          />
          </GestureDetector>
            </View>
            </GestureDetector>
        )}

        {/* Through the portal, like the rest of the rail: the blur that
            fills it has to sit outside the view it blurs. */}
        {/* The actions capsule: what can be done to the list - sort it,
            choose in it. They were rows of the "..." menu, two taps away;
            the user asked for exactly these two on the rail and no more,
            grouped, so the rail does not turn into a wall of options. */}
        {isFocused && !searchingAlone && !(isTwoPane && !!openDoc && paneFullscreen) && (
          <RailCapsule
            side={railSide}
            bottom={rail.actionsBottom}
            buttons={[
              {
                icon: isSelectMode ? 'close-outline' : 'checkmark-circle-outline',
                onPress: toggleSelectMode,
                active: isSelectMode,
              },
            ]}
          />
        )}
        <Menu
          visible={sortMenuOpen}
          onClose={() => setSortMenuOpen(false)}
          accent={ACCENT}
          entries={[
            { kind: 'section', label: 'Сортування' },
            ...FIELD_ORDER.map((field) => ({
              label: FIELD_LABELS[field],
              icon: FIELD_ICONS[field],
              checked: sortPref.field === field,
              onPress: () => {
                selectSortField(field);
                setSortMenuOpen(false);
              },
            })),
          ]}
          style={{ position: 'absolute', right: RAIL_CLEARANCE, top: chromeTop + CAPSULE_DROP }}
        />
        {/* The create capsule: a new note, and in the explorer a new folder
            beside it - each glyph shows the plus ON the thing it adds, the
            user's ask. The note button held makes a sticker, as the plus
            always did. */}
        {isFocused && !isSelectMode && !searchingAlone && !(isTwoPane && !!openDoc && paneFullscreen) && (
          <RailCapsule
            side={railSide}
            bottom={rail.addBottom}
            buttons={[
              {
                icon: 'document-text-outline',
                badge: 'add-circle-outline',
                onPress: createDocument,
                onPressIn: hapticButtonDown,
                onPressOut: hapticButtonUp,
                onLongPress: openStickerComposer,
              },
              ...(explorer
                ? [
                    {
                      icon: 'folder-outline' as const,
                      badge: 'add-circle-outline' as const,
                      onPress: () => setFolderPrompt({ mode: 'new', parent: explorerPath }),
                      onPressIn: hapticButtonDown,
                      onPressOut: hapticButtonUp,
                    },
                  ]
                : []),
            ]}
          />
        )}
        {/* Back and forward through the folders you have been in - so the
            hand need not reach for the path strip at the top. */}
        {arrowsFit && isFocused && !isSelectMode && !searchingAlone && !(isTwoPane && !!openDoc && paneFullscreen) && (
          <RailCapsule
            side={railSide}
            bottom={rail.historyBottom}
            buttons={[
              { icon: 'chevron-back-outline', onPress: explorerBack, disabled: !historyState.canBack },
              { icon: 'chevron-forward-outline', onPress: explorerForward, disabled: !historyState.canForward },
            ]}
          />
        )}
        </View>

        {/* Only where there IS a document. An empty half saying "pick
            one from the list" was half the inner screen spent on an
            instruction; with nothing open the list takes the whole width
            and shows more of itself instead. */}
        {isTwoPane && !!openDoc && (
          <View
            style={styles.editorPane}
            onLayout={(e) => setEditorPaneLeft(e.nativeEvent.layout.x)}
          >
            {openDoc && (
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
                // Its rail stands on the window's LEFT edge - this pane
                // is the left half, and the right edge is the list's.
                railLeft={editorPaneLeft + RAIL_RIGHT}
                // The line this screen's own cards start on, so the two
                // halves begin together.
                railTop={chromeBottom}
                onToggleFullscreen={() => setPaneFullscreen((v) => !v)}
              />
            )}
          </View>
        )}
      </View>

      <TagsDrawer
        ref={drawerRef}
        tags={explorerMode ? explorerTags : drawerTags}
        activeFilter={activeFilter}
        onSelectFilter={(filter) => {
          // With the folders in the list, a folder tapped in the drawer
          // is a place to go, not a filter to add.
          if (explorerMode && filter?.type === 'tags') {
            const last = filter.tagIds[filter.tagIds.length - 1];
            const tag = drawerTags.find((t) => t.id === last);
            if (tag) setExplorerPath(tag.path);
            return;
          }
          if (explorerMode && filter?.type === 'untagged') {
            setExplorerPath('');
            return;
          }
          setActiveFilter(filter);
        }}
        hideOpenButton={isSelectMode || searchingAlone}
        counts={drawerCounts}
        mode={{ value: listMode, onChange: setListMode }}
        stickers={{
          count: freeStickers.length,
          active: groupFilter === STICKERS_GROUP,
          onToggle: () => setGroupFilter(groupFilter === STICKERS_GROUP ? null : STICKERS_GROUP),
        }}
        trash={{ count: trashed.length, onOpen: () => setTrashOpen(true) }}
        groupSection={{
          // The same list the tabs show, sentinels and all, so the two
          // never disagree about what there is to pick.
          items: [
            { id: null, name: 'Всі', color: GLASS_TEXT_MUTED, count: documents.length },
            ...groups.map((g) => ({
              id: g.id,
              name: g.name,
              color: g.color,
              count: groupCounts.byGroup[g.id] ?? 0,
            })),
            {
              id: UNASSIGNED_ID,
              name: 'Без групи',
              color: GLASS_TEXT_MUTED,
              count: groupCounts.ungrouped,
            },
            {
              id: STICKERS_GROUP,
              name: 'Стікери',
              color: STICKER_YELLOW,
              count: freeStickers.length,
            },
          ],
          selected: groupFilter,
          onSelect: setGroupFilter,
        }}
      />

      <RenamePrompt
        visible={folderPrompt !== null}
        title={
          folderPrompt?.mode === 'rename'
            ? 'Назва папки'
            : folderPrompt?.parent
              ? `Нова папка в «${nameOf(folderPrompt.parent)}»`
              : 'Нова папка'
        }
        initialValue={folderPrompt?.mode === 'rename' ? nameOf(folderPrompt.path) : ''}
        placeholder="Назва папки"
        onCancel={() => setFolderPrompt(null)}
        onSave={saveFolderName}
      />

      <RenamePrompt
        visible={docRename !== null}
        title="Назва нотатки"
        initialValue={docRename?.title ?? ''}
        placeholder="Без назви"
        onCancel={() => setDocRename(null)}
        onSave={(title) => {
          const target = docRename;
          setDocRename(null);
          if (target) updateDoc(doc(db, 'documents', target.id), { title: title.trim(), updatedAt: Date.now() });
        }}
      />

      <TagEditSheet
        visible={folderEdit !== null}
        tag={folderEdit}
        onCancel={() => setFolderEdit(null)}
        onSave={(path, icon, color) => {
          const target = folderEdit;
          setFolderEdit(null);
          if (!target) return;
          // The name is the folder's path; a changed name goes through
          // renameFolder so the folders under it follow.
          list.updateTag(target, { path: target.path, icon, color }).then(() => renameFolder(target.path, path.trim()));
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
    // Reversed: the list sits on the RIGHT, against the rail that belongs
    // to it, and the open document takes the left half. Written as a
    // direction rather than by swapping the two children, so the list
    // stays the first thing in the tree - it is the screen.
    flexDirection: 'row-reverse',
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
  sideIslandLayerLeft: {
    alignItems: 'flex-start',
    paddingRight: 0,
    paddingLeft: 14,
  },
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
  // The band the group tabs and the tag chips float in, over the list.
  // The band the group tabs and the tag chips float in. It spans the
  // WHOLE window rather than the list's own pane: on a Fold the tabs are
  // MEANT to scroll out across the open document beside them. What keeps
  // them starting at the pane's edge is padding inside the scroller, not
  // the band's width.
  topChrome: {
    position: 'absolute',
    left: 0,
    right: 0,
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
  // Only where it sits - the pill itself is SearchField's.
  searchRow: {
    marginLeft: 20,
    marginRight: RAIL_CLEARANCE,
    marginBottom: 8,
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
  emptySearch: {
    flex: 1,
  },
  // «Провідник»: the folder rows above the cards, in the list's own
  // side margin, and the crumb with the way up.
  // The list's own container already keeps the rail's clearance; the
  // folder rows take only the cards' side margin, or they end up twice
  // as far from the rail as the cards below them.
  explorerHead: {
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 8,
  },
  explorerCrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  crumbUp: {
    padding: 4,
  },
  crumbStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
  },
  crumbPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  crumbSegment: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  crumbSegmentCurrent: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  crumbLabel: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT_MUTED,
  },
  crumbLabelCurrent: {
    color: GLASS_TEXT,
  },
  // Glass, like every row of the app's own lists, in the document row's
  // size - the user's words: the glass stays, only the size grows.
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  // Two across, where the list has the whole width of the inner screen.
  // The crumb strip above them stays one full-width line - it is a place,
  // not an item.
  explorerHeadWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  // The path is a place, not an item: it keeps its own full-width line
  // above the pairs.
  explorerCrumbWide: {
    width: '100%',
  },
  trashFolderRow: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  folderThumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  folderName: {
    fontSize: 18,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT,
  },
  folderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  folderMetaGap: {
    marginLeft: 10,
  },
  folderCount: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
  },
  trashHint: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
    paddingHorizontal: 4,
  },
  list: {
    paddingVertical: 8,
    // The rail stands at the right edge; the cards stop short of it rather
    // than running under it. The cards carry 20 of side margin of their
    // own, so this is what is left of the clearance. In a pane the rail is
    // on the LEFT, and listClear below swaps the two.
    paddingRight: RAIL_CLEARANCE - 20,
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
