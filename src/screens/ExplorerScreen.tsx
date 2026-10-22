import { type ComponentProps, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePublishRailPanel } from '../navigation/navRail';
import { usePins } from '../navigation/pinned';
import ExplorerPanel from '../components/desktop/ExplorerPanel';
import { formatAddedOn } from '../utils/documentPreview';
import { COMPOSER_CLEAR } from '../components/desktop/Composer';
import { explorerPlace, useExplorerCreateWanted, useExplorerWanted } from '../navigation/explorerPlace';
import { folderOpening, useFolderOpening } from '../navigation/folderOpening';
import { SwipeSelectArea, SwipeSelectItem } from '../components/SwipeSelect';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BackHandler, FlatList, Image, Modal, Platform, Pressable, ScrollView, Share, useWindowDimensions, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ZoomableImageViewer, { type ViewerAction } from '../components/ZoomableImageViewer';
import VideoPlayerModal from '../components/VideoPlayerModal';
import { getVideoEmbedInfo } from '../utils/videoEmbed';
import ScreenGround from '../components/ScreenGround';
import TopNavBar, { TOP_NAV_SPACE, useTopNavOn } from '../components/TopNavBar';
import FolderItemCard, { type FolderCardMode } from '../components/FolderItemCard';
import FoldersCanvas from '../components/FoldersCanvas';
import CascadeGrid, { notifyCascadeScroll } from '../components/CascadeGrid';
import { Ionicons } from '../components/icons/Ionicons';
import { usePaneBar } from '../navigation/paneBar';
import { selectionDock } from '../navigation/selectionDock';
import { orderSection, viewSection } from '../navigation/topMenu';
import { useChromeStyle, useDockActions, useDockBeads, useTopBack, useTopExtras, useTopSearch, useWhileFocused, useNavDockPublisher } from '../navigation/navDock';
import { useSideDrawerActions } from '../navigation/sideDrawers';
import { GlassPortal } from '../components/GlassPortal';
import { FolderCard, FolderCover, FolderGrow, FolderShrink, coverPatternJob, folderCoverHeight, type Rect4 } from '../components/ProjectFolders';
import { PatternWarmup } from '../components/FolderPattern';
import { useTheme } from '../theme/ThemeProvider';
import { useDockClearance } from '../navigation/dockGeometry';
import { SoftSurfaceContext, useSoft } from '../theme/soft';
import { useTags } from '../hooks/useTags';
import { useAllFolderItems, type FolderItem } from '../hooks/useAllFolderItems';
import { useTechnicalDocIds } from '../hooks/useTechnicalDocs';
import { useRecordPhotoIds } from '../hooks/useRecordPhotoIds';
import { useRecordLinkIds, useRecordRelationIds } from '../hooks/useRecordLinkIds';
import { isTechnicalItem } from '../utils/recordNotes';
import { openFolderItem } from '../utils/openFolderItem';
import { useSortPref } from '../hooks/useSortPref';
import { sortItems } from '../utils/sortItems';
import { FIELD_ICONS, FIELD_LABELS, FIELD_ORDER } from '../components/SortMenuRows';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import { hapticSelectItem, hapticSelectTap } from '../utils/haptics';
import RenamePrompt from '../components/RenamePrompt';
import ItemFoldersSheet from '../components/ItemFoldersSheet';
import LinkCardHost from '../components/LinkCardHost';
import DocumentQuickLook, { quickLookKindFor, type QuickLookKind } from '../components/DocumentQuickLook';
import FilePreviewWorker from '../components/FilePreviewWorker';
import FlashcardReader from '../components/FlashcardReader';
import FlashcardEditor from '../components/FlashcardEditor';
import { ensureFileIsHere, openFileExternally, shareFile } from '../utils/openFileExternally';
import { holdAsk } from '../components/surfaces/HoldAsk';
import { GestureDetector } from 'react-native-gesture-handler';
import CreateFan from '../components/CreateFan';
import QuickCreateHost from '../components/QuickCreateHost';
import CollectionWindow, { type CollectionKind } from '../components/CollectionWindow';
import ThoughtsFolder from '../components/thoughts/ThoughtsFolder';
import ProjectsBand, { NO_PROJECT } from '../components/ProjectsBand';
import CollectionCard, { collectionFaceFor, gustLeadMs, type CollectionCardKind, type CollectionFaceStyle } from '../components/CollectionCard';
import TurningPressable from '../components/TurningPressable';
import { listMoved } from '../utils/motionHold';
import PlaylistWindow, { videoOf, type PlaylistVideo } from '../components/PlaylistWindow';
import TagEditSheet from '../components/TagEditSheet';
import { FolderCardSheet, FolderProjectsSheet } from '../components/FolderStyleSheets';
import { useCreateFlow } from '../hooks/useCreateFlow';
import { openCapture } from '../components/CaptureWindow';
import Animated, { Easing as REasing, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useExplorerCarry } from '../hooks/useExplorerCarry';
import CardCarryOverlay from '../components/CardCarryOverlay';
import UndoToast from '../components/UndoToast';
import type { FolderItemKind } from '../hooks/useAllFolderItems';
import { endFlip, prepareFlip, type FlipFrom } from '../utils/flipOpen';
import { morph } from '../utils/morph';
import { openBoardZoomed } from '../utils/boardZoom';
import { openShortcut, SHORTCUT_ICON, type ShortcutParams, type ShortcutSource } from '../utils/shortcuts';
import type { Flashcard } from '../types';
import SketchEditor from '../components/SketchEditor';
import { savePhotoSketch } from '../utils/photoSketch';
import type { SketchElement } from '../types';
import { ask, confirm, notify } from '../components/surfaces/Ask';
import { binNote, purgeNote, restoreNote } from '../utils/nestedNotes';
import { detachTagFromDeletedItem } from '../hooks/useTags';
import { BIN_TTL_MS } from '../hooks/useBin';
import { useTaskAttachments } from '../hooks/useTaskAttachments';
import { cleanupCandidates } from '../utils/cleanupCandidates';
import { copyImageFile, shareImageFile } from '../utils/shareAndCopy';
import { downloadToFolder, showDownloadedFile } from '../utils/downloadToFolder';
import { useDownloadToast } from '../hooks/useDownloadToast';
import { useFlattenPhoto } from '../hooks/useFlattenPhoto';
import DownloadToast from '../components/DownloadToast';
import { FEATURES } from '../features';
import EdgeFade from '../components/EdgeFade';
import { useDensity } from '../hooks/useDensity';
import { makeChromeScroll, setChromeCompact } from '../navigation/chromeScroll';
import { askWhatToKeep } from '../components/DeleteContentsHost';
import { describeBoards, removeItems, type PlanItem } from '../utils/deletionPlan';
import { readBoardPart } from '../utils/boardStorage';
import type { BoardItem, BoardCard, BoardColumn } from '../types';
import { arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot, updateDoc } from '../firestore';
import { addDoc, ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';
import { kindsOf } from '../utils/groups';
import type { Group } from '../types';
import { db } from '../firebase';
import { toastClear } from '../constants/rail';
import { ALL_FOLDER_KINDS } from '../constants/folderKinds';
import type { Tag } from '../types';
import { folderCardSize } from '../constants/cardPalette';
import BinCard from '../components/BinCard';
import { useDockDesksHere } from '../navigation/deskBeadsBus';

// THE SINGLE EXPLORER, STEP 2 - VIEW ONLY (the one plan, 2026-10-10). One
// place that shows everything the way Finder does: the folders of this level,
// then the things in it - notes, boards, cards, photos, files, links, videos
// and geo points, mixed, each drawn as the card its own database draws. The
// root also holds what lies in NO folder. It writes nothing: opening a thing
// opens it in its own interface and the way back lands here, in the same
// folder (this screen stays mounted under it).
//
// A thing in several folders stands in each of them, like a shortcut.
// Custom-database rows and task lists are not here (step 6: shortcuts).

const FOLDER_GAP = 10;
const nameOf = (path: string) => path.split('/').pop() ?? path;
const stamp = (item: FolderItem) => {
  const raw = (item.raw ?? {}) as Record<string, unknown>;
  const n = (raw.updatedAt ?? raw.createdAt) as unknown;
  return typeof n === 'number' ? n : 0;
};

// The kinds in the order «Групувати за типом» lays them out (the user, 2026-10-10:
// boards first, then pictures... - one view of everything wants this).
const KIND_ORDER = ['shortcut', 'document', 'board', 'flashcard', 'photo', 'link-video', 'link-other', 'link-geo', 'file'];
const KIND_TITLE: Record<string, string> = {
  shortcut: 'Ярлики',
  document: 'Нотатки',
  board: 'Дошки',
  flashcard: 'Картки',
  photo: 'Зображення',
  'link-video': 'Відео',
  'link-other': 'Посилання',
  'link-geo': 'Геоточки',
  file: 'Файли',
};
const kindKey = (item: FolderItem) => (item.kind === 'link' ? `link-${item.linkCategory ?? 'other'}` : item.kind);
type Row = { header: string; count: number; key: string } | { cascade: FolderItem[]; key: string } | { strip: FolderItem[]; key: string } | FolderItem;
const isHeader = (row: Row): row is { header: string; count: number; key: string } => 'header' in row;
const isCells = (row: Row): row is { cascade: FolderItem[]; key: string } => 'cascade' in row;
// A run of photos in the LIST view: bare rounded squares, three to a line (the user, 2026-10-14: no card, no stretching).
const isStrip = (row: Row): row is { strip: FolderItem[]; key: string } => 'strip' in row;
// A collection's window turns over in this long (a record's card: FLIP_MS, 460).
const COLLECTION_FLIP_MS = 340;

// THE CASCADE (the user, 2026-10-12): see components/CascadeGrid. A card's height is ESTIMATED from its
// kind until it has been drawn and measured.
function estimateHeight(item: FolderItem, w: number): number {
  switch (item.kind) {
    case 'photo':
      // On photo paper: 6 above the square, 18 below it.
      return FEATURES.itemLook ? w + 12 : w;
    case 'document':
      return Math.round(w * 1.6) + 64;
    case 'link':
      return item.linkCategory === 'geo' ? Math.round(w * 0.9) + 76 : Math.round(w * 0.56) + 96;
    case 'file':
      return Math.round(w * 0.7) + 70;
    default:
      return Math.round(w * 0.78) + 70;
  }
}

// The face of a playlist in the explorer: the first videos stacked like a pile, the name and how many.
// (The mosaic design from the mockups - tall icon plate + 3 columns of 16:9 previews - was built 2026-10-11 and
// ROLLED BACK the same day: «погано, відміняй». The sketch design before it was rolled back too.)
function PlaylistFace({ videos, name, count }: { videos: PlaylistVideo[]; name: string; count: number }) {
  const S = useSoft();
  return (
    <>
      <View style={{ height: 84 }}>
        {[2, 1, 0].map((k) => {
          const v = videos[k];
          return (
            <View
              key={k}
              style={{ position: 'absolute', left: k * 8, right: (2 - k) * 8, top: (2 - k) * 8, height: 62, borderRadius: 10, overflow: 'hidden', backgroundColor: S.fill, opacity: k === 2 ? 0.6 : k === 1 ? 0.8 : 1 }}
            >
              {v?.thumb ? <Image source={{ uri: v.thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
              {k === 0 && (
                <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name={'play-outline' as never} size={22} color="#fff" />
                </View>
              )}
            </View>
          );
        })}
      </View>
      <Text style={[styles.folderName, { color: S.ink }]} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.folderCount, { color: S.ink3 }]}>{`Плейліст · ${count}`}</Text>
    </>
  );
}

// «НЕРОЗКЛАДЕНЕ» (2026-10-19, the user's: the start screen holds only folders, and one more folder with everything
// that is in none): not a tag, a place of the explorer's own. Its path starts with a zero-width space, so it can never
// be a folder someone made, and it reads as its name wherever a path is shown. Nothing is ever written under it: a
// thing «moved into» it is taken out of its folder, a thing made inside it is made in no folder (folderOf).
export const UNFILED = '\u200BНерозкладене';
const UNFILED_TAG: Tag = {
  id: UNFILED,
  path: UNFILED,
  icon: 'file-tray-outline',
  color: '#DEDCD7',
  types: [],
  usedIn: {},
  keep: true,
  card: { size: 'M', color: 'mist', pattern: 'light' },
};
// The folder a path stands for when writing: none for the root and for «Нерозкладене».
const folderOf = (p: string | null | undefined): string | null => (p && p !== UNFILED ? p : null);
export type FolderEntry = { path: string; name: string; color?: string; icon?: string; count: number; playlist?: boolean; collection?: CollectionKind; size?: 'S' | 'M' | 'L' };

// What a search reads of a thing: its title, and whatever text its kind carries.
function matchesNeedle(item: FolderItem, needle: string): boolean {
  if (item.title.toLowerCase().includes(needle)) return true;
  const raw = (item.raw ?? {}) as Record<string, unknown>;
  for (const key of ['url', 'siteName', 'description', 'fileName', 'text', 'term', 'explanation']) {
    const v = raw[key];
    if (typeof v === 'string' && v.toLowerCase().includes(needle)) return true;
  }
  const blocks = raw.blocks;
  if (Array.isArray(blocks)) {
    for (const b of blocks as { text?: unknown }[]) if (typeof b?.text === 'string' && b.text.toLowerCase().includes(needle)) return true;
  }
  return false;
}

// A FOLDER'S THINGS ARRIVING (2026-10-12, the user's: «якщо ми вміст показуємо пізніше, то давай вже анімацію...
// розширення з якогось кутка, картки по черзі»): each card grows out of the top-left, a little after the one
// before it. Only on stepping into a folder through its opening - never for cards scrolled into view.
// The bin's place among the folder cards of «Модерний» - not a folder path anyone can make (no tag has it).
const BIN_PATH = '\u0000bin';

function cornerIn(delay: number) {
  return () => {
    'worklet';
    const ease = REasing.bezier(0.22, 1, 0.36, 1);
    return {
      initialValues: { opacity: 0, transform: [{ translateX: -26 }, { translateY: -20 }, { scale: 0.8 }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: 220 })),
        transform: [
          { translateX: withDelay(delay, withTiming(0, { duration: 340, easing: ease })) },
          { translateY: withDelay(delay, withTiming(0, { duration: 340, easing: ease })) },
          { scale: withDelay(delay, withTiming(1, { duration: 340, easing: ease })) },
        ],
      },
    };
  };
}

// `desk`: standing as a DESK of the phone (the first one): the island draws the bar, as for the Documents desk -
// the screen draws none of its own (one over every layer was the 2026-10-11 mishap), and at its root has no way back.
// A `data-*` attribute for the DOM (the Finder rule's ground-click test); nothing on the phone.
const webData = (d: Record<string, string>): object => (Platform.OS === 'web' ? { dataSet: d } : {});

export default function ExplorerScreen({ inPane, desk }: { inPane?: boolean; desk?: boolean } = {}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const touchDensity = useDensity() === 'touch';
  // The chrome folds while this list is read (features.chromeCompact) and is brought back on a new folder and on
  // leaving the screen.
  const chromeScroll = useMemo(() => makeChromeScroll(), []);
  useEffect(() => {
    if (!isFocused) setChromeCompact(false);
  }, [isFocused]);
  useEffect(() => () => setChromeCompact(false), []);
  const topNavOn = useTopNavOn();
  const paneBar = usePaneBar();
  const dockClear = useDockClearance();
  useChromeStyle('soft', isFocused);
  const [path, setPath] = useState('');
  // BACK / FORWARD through the folders visited (the Finder's pair), kept apart from «up one level»:
  // they sit in the «⋯» menu, and only while there is somewhere to go.
  const history = useRef({ stack: [''] as string[], at: 0, going: false });
  const [, bumpHistory] = useState(0);
  useEffect(() => {
    const h = history.current;
    if (h.going) {
      h.going = false;
      bumpHistory((n) => n + 1);
      return;
    }
    if (h.stack[h.at] === path) return;
    h.stack = [...h.stack.slice(0, h.at + 1), path];
    h.at = h.stack.length - 1;
    bumpHistory((n) => n + 1);
  }, [path]);
  function goHistory(delta: number) {
    const h = history.current;
    const next = h.at + delta;
    if (next < 0 || next >= h.stack.length) return;
    h.at = next;
    h.going = true;
    setPath(h.stack[next]);
  }
  const folderLabel = (p: string) => (p ? nameOf(p) : 'Провідник');
  const tagApi = useTags();
  const { tags: allTags, attachTag, detachTag, createFolderTag, moveBranch, setFolderAppearance, updateTag, setTagFields, deleteTagCompletely } = tagApi;
  // A base's own collections (Tag.baseOnly) - and every folder under one - are not the explorer's until placed here.
  const tags = useMemo(() => {
    // Placed (inExplorer) - it and every collection under it, made before or after the placing, show here.
    const placed = allTags.filter((t) => t.baseOnly && t.inExplorer).map((t) => t.path);
    const isPlaced = (path: string) => placed.some((p) => path === p || path.startsWith(`${p}/`));
    // Only the collections themselves are left out: an explorer folder of the same name stays.
    return allTags.filter((t) => !t.baseOnly || isPlaced(t.path));
  }, [allTags]);
  // The same «Порядок» the bases have (alphabet / created / changed, ↑↓), kept for this screen.
  const { sortPref, selectSortField } = useSortPref('explorerSort');
  // THE VIEW (the one plan, 2026-10-11): a list of rows, a grid of tiles, or wide cards (one
  // tile a line, bigger picture). Remembered on this device.
  const [viewMode, setViewMode] = useState<FolderCardMode | 'canvas'>('list');
  useEffect(() => {
    AsyncStorage.getItem('explorerView').then((v) => (v === 'grid' || v === 'canvas') && setViewMode(v)).catch(() => {});
  }, []);
  const changeView = (m: FolderCardMode | 'canvas') => {
    setViewMode(m);
    AsyncStorage.setItem('explorerView', m).catch(() => {});
  };
  // «СТИЛЬ ПРОВІДНИКА» (2026-10-12, the user's): «Чистий» - the folders as this screen draws them; «Модерний» - the
  // same folders drawn as the «Проєкти» page drew them (see modernLook below: a look only). Remembered on this device.
  // The Mac/browser opens «Модерний» unless told otherwise (2026-10-16: the explorer came to the Mac to show the phone's
  // look, and its own bar has no «⋯» to pick it with).
  // «Проєкти» (2026-10-22): the «Модерний» cards, but the first level opens with the projects band and shows only the folders of the
  // project in front (components/ProjectsBand); «Без проєкту» is the first stop.
  const [explorerStyle, setExplorerStyle] = useState<'clean' | 'modern' | 'projects'>(Platform.OS === 'web' ? 'modern' : 'clean');
  useEffect(() => {
    AsyncStorage.getItem('explorerStyle')
      .then((v) => (v === 'modern' || v === 'clean' || (v === 'projects' && FEATURES.explorerProjects)) && setExplorerStyle(v))
      .catch(() => {});
  }, []);
  const changeStyle = (next: 'clean' | 'modern' | 'projects') => {
    setExplorerStyle(next);
    AsyncStorage.setItem('explorerStyle', next).catch(() => {});
  };
  // The project in front in that style ('' = «Без проєкту»); remembered on this device.
  const [focusProj, setFocusProj] = useState<string>(NO_PROJECT);
  useEffect(() => {
    AsyncStorage.getItem('explorerProject')
      .then((v) => typeof v === 'string' && setFocusProj(v))
      .catch(() => {});
  }, []);
  const changeFocusProj = (id: string) => {
    setFocusProj(id);
    AsyncStorage.setItem('explorerProject', id).catch(() => {});
  };
  // The folder whose projects are being picked from a card's «у проєкт…».
  const [projectsFor, setProjectsFor] = useState<Tag | null>(null);
  // The card a folder is opening out of in «Модерний», for the opening's motion (FolderGrow).
  // The folder the opening stepped into has been drawn: the opening may fade.
  // THE CLOSING in «Модерний»: the folder being left, shrinking back into its card one level up (FolderShrink); its
  // landing place is measured once the level above is drawn.
  const [shrinking, setShrinking] = useState<{ tag: Tag; path: string; mine: FolderItem[]; subs: number; to: Rect4 | null; checked?: boolean } | null>(null);
  const cardNodes = useRef(new Map<string, View>());
  // Stepping in through the opening: first the cover alone ('cover' - cheap, so the opening can hand over at once),
  // then everything else, arriving card by card (cornerIn) while `arrivalAt` is fresh.
  const [stage, setStage] = useState<'all' | 'cover'>('all');
  const arrivalAt = useRef(0);
  const arriving = () => Date.now() - arrivalAt.current < 700;
  const showContent = () => {
    arrivalAt.current = Date.now();
    setStage('all');
  };
  const { width: winW } = useWindowDimensions();
  // THE WIDTH THE LIST REALLY HAS (2026-10-19, the Mac audit): on a pointer it is the column between the sidebar and
  // the right panel, measured where the list stands - not the window less 40, capped at 1100, which gave four wide
  // columns on an 1800 window. The window's width stays the first guess until the list has been laid out, and the
  // phone's answer, where the list is the window.
  const [measuredW, setMeasuredW] = useState(0);
  // THE FINDER RULE on the Mac (frame B, 2026-10-19, agreed): one click CHOOSES a card (a ring, and the right panel
  // shows it), a second click within half a second - or Enter - opens it; Escape and a click on the ground let go.
  // The phone keeps its tap-opens. `chosen` is an item id, or `folder:<path>` for a folder card.
  const explorerSelect = FEATURES.macFrameB && Platform.OS === 'web' && !inPane;
  const [chosen, setChosen] = useState<string | null>(null);
  const lastPick = useRef<{ id: string; at: number }>({ id: '', at: 0 });
  const chosenOpen = useRef<(() => void) | null>(null);
  // True when this press is the second of a pair (open now); false when it only chose.
  const pickTwice = (id: string, open: () => void): boolean => {
    const now = Date.now();
    if (lastPick.current.id === id && now - lastPick.current.at < 450) {
      lastPick.current = { id: '', at: 0 };
      setChosen(null);
      return true;
    }
    lastPick.current = { id, at: now };
    chosenOpen.current = open;
    setChosen(id);
    return false;
  };
  useEffect(() => {
    if (!explorerSelect || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setChosen(null);
      else if (e.key === 'Enter' && chosen && chosenOpen.current && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setChosen(null);
        chosenOpen.current();
      }
    };
    // A click on the explorer's own ground (not on a card) lets go of the chosen one.
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && t.closest && t.closest('[data-explorer]') && !t.closest('[data-card]')) setChosen(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [explorerSelect, chosen]);
  const contentW = !touchDensity && measuredW > 0 ? measuredW - 40 : Math.min(winW, 1100) - 40;
  const gridCols = winW >= 640 ? 3 : 2;
  const TILE_GAP = 12;
  const tileW = viewMode === 'wide' ? contentW : Math.floor((contentW - TILE_GAP * (gridCols - 1)) / gridCols);
  // «Групувати за типом»: remembered on this device.
  const [byKind, setByKind] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('explorerByKind').then((v) => setByKind(v === '1')).catch(() => {});
  }, []);
  // «Фільтри»: the chip row is OFF until asked for (the user, 2026-10-11: a carousel that is
  // always there is noise); remembered on this device. Turning it off clears the filters.
  const [chipsOn, setChipsOn] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('explorerChips').then((v) => setChipsOn(v === '1')).catch(() => {});
  }, []);
  const toggleChips = () =>
    setChipsOn((on) => {
      AsyncStorage.setItem('explorerChips', on ? '0' : '1').catch(() => {});
      if (on) {
        setKindFilter(new Set());
        setKindOut(new Set());
        setProjFilter(null);
        setProjOut(null);
      }
      return !on;
    });
  const toggleByKind = () =>
    setByKind((on) => {
      AsyncStorage.setItem('explorerByKind', on ? '0' : '1').catch(() => {});
      return !on;
    });
  const all = useAllFolderItems(tags, { includeUnfiled: true, withBinned: true });
  const technicalDocs = useTechnicalDocIds();
  const recordPhotoIds = useRecordPhotoIds();
  const recordLinkIds = useRecordLinkIds();
  const recordFileIds = useRecordRelationIds('files');
  const taskAttachments = useTaskAttachments();

  // Not custom-database rows, and not what the bases themselves call TECHNICAL
  // (the same rule they use, utils/recordNotes.isTechnicalItem): a picture, link
  // or file that a record of an app/database holds, or only a technical note
  // uses, and no ordinary note does. They stay in their own bases.
  const items = useMemo(
    () =>
      all.filter((item) => {
        if (item.kind === 'row') return false;
        const raw = (item.raw ?? {}) as Record<string, unknown>;
        if (raw.deletedAt) return false; // in the bin: only the Кошик shows it
        // THE EXPLORER SHOWS WHAT WAS PUT IN IT: a photo, video, geo point or link in no folder lives in its own base only.
        if (FEATURES.explorerFiledOnly && (item.kind === 'photo' || item.kind === 'link') && item.tagIds.length === 0) return false;
        const used = Object.keys((raw.usedInDocuments as Record<string, boolean>) ?? {});
        const record = item.kind === 'photo' ? recordPhotoIds : item.kind === 'link' ? recordLinkIds : item.kind === 'file' ? recordFileIds : null;
        if (record && isTechnicalItem(item.docId, used, record, technicalDocs)) return false;
        // A picture a TASK carries belongs to that task: it does not stand in the root (nor in a
        // note the task is mirrored in) until the user files it in a folder or a project.
        if (item.kind === 'photo' && taskAttachments.has(item.docId) && item.tagIds.length === 0 && !raw.groupId) return false;
        return true;
      }),
    [all, technicalDocs, recordPhotoIds, recordLinkIds, recordFileIds, taskAttachments]
  );

  // THE BIN (Кошик): what was deleted, newest first - restored or removed for good here.
  const [inBin, setInBin] = useState(false);
  const binned = useMemo(
    () =>
      all
        .filter((i) => i.kind !== 'row' && !!(i.raw as Record<string, unknown> | undefined)?.deletedAt)
        .sort((a, b) => Number((b.raw as Record<string, unknown>).deletedAt) - Number((a.raw as Record<string, unknown>).deletedAt)),
    [all]
  );

  // «КАНДИДАТИ НА ОЧИЩЕННЯ»: what nothing holds (see utils/cleanupCandidates). Shown in a view of its
  // own; the task leftovers among them (`auto`) are binned by themselves, once per visit.
  const [inCleanup, setInCleanup] = useState(false);
  // The Mac's sidebar reads where the explorer stands and sends it places (navigation/explorerPlace).
  useEffect(() => {
    explorerPlace.report(path);
  }, [path]);
  const wantedPath = useExplorerWanted();
  useEffect(() => {
    if (wantedPath === null || !isFocused) return;
    const p = explorerPlace.take();
    if (p !== null) {
      setInBin(false);
      setInCleanup(false);
      setPath(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedPath, isFocused]);
  // Into / out of the bin or the cleanup list the list starts at its top: the chrome whole again (it stayed folded
  // at the root's top after leaving the bin - nothing left to scroll that would unfold it, 2026-10-14).
  useEffect(() => {
    setChromeCompact(false);
  }, [inBin, inCleanup]);
  const candidates = useMemo(() => cleanupCandidates(all, taskAttachments, technicalDocs), [all, taskAttachments, technicalDocs]);
  const candidateItems = useMemo(() => candidates.map((c) => c.item), [candidates]);
  // What a chosen id means: in the cleanup view the candidates (hidden elsewhere), else the shown things.
  const pool = inCleanup ? candidateItems : items;

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  // Every thing's folder paths, once.
  const pathsOf = useMemo(() => {
    const m = new Map<string, string[]>();
    items.forEach((item) => m.set(item.id, item.tagIds.map((id) => tagById.get(id)?.path).filter((p): p is string => !!p)));
    return m;
  }, [items, tagById]);

  // THE FILTER CHIPS (the one plan, step 4): a kind and a project narrow what the level shows;
  // folders that hold none of it step aside while a filter is on. Nothing is saved yet.
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set());
  const [projFilter, setProjFilter] = useState<string | null>(null);
  // EXCLUDED kinds (the user, 2026-10-11): a long press on a chip takes that kind OUT of the list.
  const [kindOut, setKindOut] = useState<Set<string>>(new Set());
  // A project can be EXCLUDED too (held on the chip, then chosen): everything but that project.
  const [projOut, setProjOut] = useState<string | null>(null);
  const filtering = kindFilter.size > 0 || kindOut.size > 0 || projFilter !== null || projOut !== null;
  // SEARCH (A2 of the remaining plan): looks through EVERY folder at once, over what the filters
  // leave; a found folder is a place to go, a found thing opens as it does anywhere.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const needle = searchText.trim().toLowerCase();
  const searching = searchOpen && needle.length > 0 && !inBin && !inCleanup;
  function closeSearch() {
    setSearchOpen(false);
    setSearchText('');
  }
  const shown = useMemo(
    () =>
      !filtering
        ? items
        : items.filter((i) => {
            const g = ((i.raw ?? {}) as Record<string, unknown>).groupId;
            if (kindFilter.size > 0 && !kindFilter.has(kindKey(i))) return false;
            if (kindOut.has(kindKey(i))) return false;
            if (projFilter === '__none__') return !g;
            if (projFilter && g !== projFilter) return false;
            if (projOut && g === projOut) return false;
            return true;
          }),
    [items, kindFilter, kindOut, projFilter, projOut, filtering]
  );
  const kindCounts = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i) => m.set(kindKey(i), (m.get(kindKey(i)) ?? 0) + 1));
    return m;
  }, [items]);

  // The folder cards of one LEVEL (a path; '' = the root): what hangs one step under it, counted over what the filters leave.
  const entriesFor = (levelPath: string): FolderEntry[] => {
    const prefix = levelPath ? `${levelPath}/` : '';
    const names = new Map<string, Tag | undefined>();
    tags.forEach((t) => {
      if (levelPath ? !t.path.startsWith(prefix) : false) return;
      const rest = levelPath ? t.path.slice(prefix.length) : t.path;
      const first = rest.split('/')[0];
      if (!first) return;
      const full = prefix + first;
      if (!names.has(full) || t.path === full) names.set(full, t.path === full ? t : names.get(full));
    });
    return Array.from(names.entries())
      .map(([full, tag]) => {
        const inside = shown.filter((item) => (pathsOf.get(item.id) ?? []).some((p) => p === full || p.startsWith(`${full}/`)));
        // A folder with ONLY «YouTube / TikTok» ticked is a PLAYLIST: it is drawn as a card and opens its own window.
        const leaf = !tags.some((t) => t.path.startsWith(`${full}/`));
        const only = !!tag && (tag.types ?? []).length === 1 ? tag.types[0] : null;
        const playlist = leaf && only === 'link-video';
        // A folder of only photos / only geo points is a COLLECTION (2026-10-14): it opens its own window, as a playlist does.
        // 2026-10-15: only a REAL collection (made in its base, Tag.baseOnly) - an explorer folder that happens to hold
        // nothing but photos stays a folder («концепти» opened as a collection window).
        const collection: CollectionKind | undefined = FEATURES.collections && leaf && tag?.baseOnly ? (only === 'photo' ? 'photo' : only === 'link-geo' ? 'geo' : undefined) : undefined;
        return { path: full, name: nameOf(full), color: tag?.color, icon: tag?.icon, count: inside.length, playlist, collection, size: collection ? tag?.card?.size ?? 'M' : folderCardSize(tag?.card) };
      })
      .filter((f) => !filtering || f.count > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const foldersAll = useMemo<FolderEntry[]>(() => {
    const prefix = path ? `${path}/` : '';
    if (inBin || inCleanup) return [];
    if (searching) {
      // Every folder at any depth whose own name matches.
      const found = new Map<string, Tag>();
      tags.forEach((t) => {
        if (nameOf(t.path).toLowerCase().includes(needle)) found.set(t.path, t);
      });
      return Array.from(found.entries())
        .map(([full, tag]) => ({
          path: full,
          name: full.split('/').join(' › '),
          color: tag.color,
          icon: tag.icon,
          count: shown.filter((item) => (pathsOf.get(item.id) ?? []).some((p) => p === full || p.startsWith(`${full}/`))).length,
        }))
        .sort((x, y) => x.name.localeCompare(y.name));
    }
    const list = entriesFor(path);
    if (!FEATURES.unfiledFolder || path) return list;
    // «Нерозкладене» first, while there is anything in it.
    const unfiled = shown.filter((item) => (pathsOf.get(item.id) ?? []).length === 0).length;
    return unfiled > 0 ? [{ path: UNFILED, name: nameOf(UNFILED), count: unfiled, playlist: false, collection: undefined, size: 'M' as const }, ...list] : list;
  }, [tags, shown, pathsOf, path, inBin, inCleanup, filtering, searching, needle]);

  // THE PROJECTS STYLE'S FIRST LEVEL: only the folders of the project in front (a folder is in a project when a tag of its path
  // carries the project in groupIds); «Без проєкту» keeps what is in none, with «Нерозкладене».
  const projectsOn = explorerStyle === 'projects' && FEATURES.explorerProjects;
  const projectsHere = projectsOn && !path && !inBin && !inCleanup && !searching && !filtering;
  const projectIdsOf = useMemo(() => {
    const m = new Map<string, Set<string>>();
    tags.forEach((t) => {
      if (!t.groupIds?.length) return;
      const set = m.get(t.path) ?? new Set<string>();
      t.groupIds.forEach((id) => set.add(id));
      m.set(t.path, set);
    });
    return m;
  }, [tags]);
  // The folders that ARE a project (Tag.projectRoots): project id -> their paths.
  const rootPathsOf = useMemo(() => {
    const m = new Map<string, Set<string>>();
    tags.forEach((t) =>
      t.projectRoots?.forEach((id) => {
        const set = m.get(id) ?? new Set<string>();
        set.add(t.path);
        m.set(id, set);
      })
    );
    return m;
  }, [tags]);
  const focusRoots = useMemo(() => (projectsOn && focusProj !== NO_PROJECT ? [...(rootPathsOf.get(focusProj) ?? [])].sort() : []), [projectsOn, focusProj, rootPathsOf]);
  const folders = useMemo<FolderEntry[]>(() => {
    if (!projectsHere) return foldersAll;
    const mine = foldersAll.filter((f) => {
      const ids = projectIdsOf.get(f.path);
      if (focusProj === NO_PROJECT) return f.path === UNFILED || !ids || ids.size === 0;
      return !!ids && ids.has(focusProj) && !focusRoots.includes(f.path);
    });
    // A root folder is the project itself: its own subfolders stand here, the folder is not a card.
    const fromRoots = focusRoots.flatMap((r) => entriesFor(r));
    return [...mine, ...fromRoots].sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldersAll, projectsHere, projectIdsOf, focusProj, focusRoots, tags, shown, pathsOf, filtering]);
  const bandCounts = useMemo(() => {
    const m = new Map<string, { folders: number }>();
    foldersAll.forEach((f) => projectIdsOf.get(f.path)?.forEach((id) => m.set(id, { folders: (m.get(id)?.folders ?? 0) + 1 })));
    return m;
  }, [foldersAll, projectIdsOf]);
  const bandNoneCount = useMemo(() => foldersAll.filter((f) => f.path !== UNFILED && !(projectIdsOf.get(f.path)?.size)).length, [foldersAll, projectIdsOf]);

  const here = useMemo(() => {
    if (inBin) return binned;
    if (inCleanup) return candidateItems;
    const list = searching
      ? shown.filter((item) => matchesNeedle(item, needle))
      : shown.filter((item) => {
          const paths = pathsOf.get(item.id) ?? [];
          // The root keeps only folders; what is in none is in «Нерозкладене».
          if (path === UNFILED) return paths.length === 0;
          // In a project whose root is a folder, the things lying directly in that folder are the project's loose things.
          if (!path && projectsHere && focusRoots.length > 0) return focusRoots.some((r) => paths.includes(r));
          return path ? paths.includes(path) : !FEATURES.unfiledFolder && paths.length === 0;
        });
    const num = (item: FolderItem, key: string) => {
      const v = ((item.raw ?? {}) as Record<string, unknown>)[key];
      return typeof v === 'number' ? v : undefined;
    };
    return sortItems(list, sortPref, (i) => i.title, (i) => num(i, 'createdAt'), (i) => stamp(i));
  }, [shown, pathsOf, path, sortPref, inBin, binned, inCleanup, candidateItems, searching, needle, focusRoots, projectsHere]);

  // The cards in the order the list draws them - what a swipe's «from here to there» means (components/SwipeSelect).
  const sweepOrderOf = (list: Row[]) =>
    list.flatMap((r) => (isHeader(r) ? [] : isCells(r) ? r.cascade.map((i) => i.id) : isStrip(r) ? r.strip.map((i) => i.id) : [r.id]));

  // What the list draws: the things in order, or in sections by kind (each section in the same order).
  const rows = useMemo<Row[]>(() => {
    const flat: Row[] = [];
    if (!byKind) flat.push(...here);
    else
      KIND_ORDER.forEach((k) => {
        const group = here.filter((i) => kindKey(i) === k);
        if (group.length) flat.push({ header: KIND_TITLE[k], count: group.length, key: `h:${k}` }, ...group);
      });
    if (viewMode !== 'grid') {
      if (!FEATURES.itemLook || viewMode !== 'list') return flat;
      // ALL the photos of a section are drawn TOGETHER, three to a line, at the place of its first photo (the user,
      // 2026-10-14: «фото тягнуться до фото, дірки заповнюються; назв не видно, то й порядок не важливий») - a lone
      // photo between two links left a line two thirds empty.
      const isPhoto = (r: Row) => !isHeader(r) && (r as FolderItem).kind === 'photo' && typeof ((r as FolderItem).raw as Record<string, unknown> | undefined)?.imageUri === 'string';
      const merged: Row[] = [];
      let section: Row[] = [];
      const flushSection = () => {
        const photos = section.filter(isPhoto) as FolderItem[];
        let placed = false;
        section.forEach((r) => {
          if (!isPhoto(r)) {
            merged.push(r);
            return;
          }
          if (placed) return;
          placed = true;
          for (let i = 0; i < photos.length; i += 3) {
            const part = photos.slice(i, i + 3);
            merged.push({ strip: part, key: `p:${part[0].id}` });
          }
        });
        section = [];
      };
      flat.forEach((r) => {
        if (isHeader(r)) {
          flushSection();
          merged.push(r);
        } else section.push(r);
      });
      flushSection();
      return merged;
    }
    // The grid: every run of things between headers is cascaded into columns.
    const out: Row[] = [];
    let run: FolderItem[] = [];
    const flush = () => {
      if (run.length) out.push({ cascade: run, key: `c:${run[0].id}` });
      run = [];
    };
    flat.forEach((r) => {
      if (isHeader(r)) {
        flush();
        out.push(r);
      } else run.push(r as FolderItem);
    });
    flush();
    return out;
  }, [here, byKind, viewMode, gridCols, tileW]);
  const sweepOrder = useMemo(() => sweepOrderOf(rows), [rows]);

  // A PICTURE OPENS RIGHT HERE, over the explorer (the user, 2026-10-10: opening
  // one and closing it dropped you into the Photos base, one more step back).
  // It pages through the pictures of THIS folder, not the whole base.
  const [viewerId, setViewerId] = useState<string | null>(null);
  const photosHere = useMemo(() => here.filter((i) => i.kind === 'photo' && typeof (i.raw as Record<string, unknown> | undefined)?.imageUri === 'string'), [here]);
  const viewerIndex = viewerId ? photosHere.findIndex((i) => i.id === viewerId) : -1;
  const viewerItem = viewerIndex >= 0 ? photosHere[viewerIndex] : null;
  const viewerRaw = (viewerItem?.raw ?? {}) as Record<string, unknown>;
  // A video plays right here too, full screen over the explorer.
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  // Everything opens HERE, in the explorer's own windows (the rule of 2026-10-11:
  // it must stand without any base's screen). Notes and boards are the only
  // ones that leave - to their own editors, which are programs, not bases.
  const [linkId, setLinkId] = useState<string | null>(null);
  const [quickLook, setQuickLook] = useState<{ uri: string; name: string; kind: QuickLookKind; item: FolderItem } | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [cardImage, setCardImage] = useState<{ card: Flashcard; index: number } | null>(null);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  // A link's card turns over from the card it was opened from (utils/flipOpen), dropped once it has turned back.
  const [linkFlip, setLinkFlip] = useState<FlipFrom | null>(null);
  useEffect(() => {
    if (linkId !== null) return;
    const spent = setTimeout(() => {
      setLinkFlip(null);
      endFlip();
    }, 700);
    return () => clearTimeout(spent);
  }, [linkId]);
  // A flashcard turns over into its reader the same way.
  const [cardFlip, setCardFlip] = useState<FlipFrom | null>(null);
  useEffect(() => {
    if (cardId !== null) return;
    const spent = setTimeout(() => {
      setCardFlip(null);
      endFlip();
    }, 700);
    return () => clearTimeout(spent);
  }, [cardId]);
  const openItem = (item: FolderItem, event?: import('react-native').GestureResponderEvent) => {
    const raw = (item.raw ?? {}) as Record<string, unknown>;
    if (item.kind === 'photo' && photosHere.some((p) => p.id === item.id)) setViewerId(item.id);
    // Every link - a video too - opens ITS CARD (the card plays the video, holds the comment...).
    else if (item.kind === 'link') {
      prepareFlip(item.docId, event).then((flip) => {
        setLinkFlip(flip);
        setLinkId(item.id);
      });
    }
    else if (item.kind === 'file') openFileHere(item);
    else if (item.kind === 'flashcard') {
      prepareFlip(item.docId, event).then((flip) => {
        setCardFlip(flip);
        setCardId(item.id);
      });
    }
    // A note is PAPER: its card grows into the page (utils/morph), it does not turn.
    else if (item.kind === 'document') {
      morph(`note:${item.docId}`, (morphing) =>
        (navigation as unknown as { navigate: (name: string, params?: object) => void }).navigate('Editor', {
          documentId: item.docId,
          ...(morphing ? { morph: true } : {}),
        })
      );
    }
    else if (item.kind === 'shortcut') {
      if (!openShortcut(navigation, raw)) notify('Ярлик порожній', 'Не знаю, що відкривати.');
    }
    else if (item.kind === 'board' && FEATURES.boardZoom && Platform.OS !== 'web') openBoardZoomed(navigation, item.docId);
    else openFolderItem(navigation, item);
  };
  async function openFileHere(item: FolderItem) {
    const raw = (item.raw ?? {}) as Record<string, unknown>;
    const file = {
      id: item.docId,
      fileUri: raw.fileUri as string,
      fileName: (raw.fileName as string) ?? item.title,
      mimeType: raw.mimeType as string | undefined,
      driveFileId: raw.driveFileId as string | undefined,
    };
    const kind = quickLookKindFor(file.fileName);
    // A Word/Excel/PDF is read here; anything else is handed to the system's program.
    if (kind) {
      if (await ensureFileIsHere(file)) setQuickLook({ uri: file.fileUri, name: (raw.title as string) || file.fileName, kind, item });
    } else await openFileExternally(file);
  }
  const cardsHere = useMemo(
    () =>
      here
        .filter((i) => i.kind === 'flashcard')
        .map((i) => {
          const r = (i.raw ?? {}) as Record<string, unknown>;
          return {
            id: i.docId,
            term: (r.term as string) ?? i.title,
            explanation: (r.explanation as string) ?? '',
            images: (r.images as Flashcard['images']) ?? [],
            groupId: r.groupId as string | undefined,
            tagIds: i.tagIds,
            known: r.known as boolean | undefined,
            short: r.short as boolean | undefined,
            createdAt: r.createdAt as number | undefined,
            updatedAt: (r.updatedAt as number) ?? 0,
          } as Flashcard;
        }),
    [here]
  );
  const cardIndex = cardId ? cardsHere.findIndex((c) => `flashcards:${c.id}` === cardId) : -1;
  const linkItem = linkId ? items.find((i) => i.id === linkId) ?? null : null;

  // CLEARING (step 3): choose things, move them into a folder, or bin them.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    hapticSelectTap();
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // The last picked card let go by a tap ends the mode (not in the bin or the clean-up, which are select modes of
    // their own), as a swipe does (2026-10-19, the user's).
    if (next.size === 0 && FEATURES.swipeSelect && !inBin && !inCleanup) {
      setSelecting(false);
      setSelected(next);
      return;
    }
    setSelected(next);
  };
  const leaveSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const [naming, setNaming] = useState<'new' | 'move' | null>(null);
  const [renaming, setRenaming] = useState<FolderItem | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<FolderEntry | null>(null);
  // A playlist's window (a folder that holds only videos).
  const [playlistPath, setPlaylistPath] = useState<string | null>(null);
  const [collectionOpen, setCollectionOpen] = useState<{ path: string; kind: CollectionKind } | null>(null);
  // OPENING A COLLECTION from its middle card (photos, points): the wind blows its pictures off the card first
  // (CollectionCard's gust), then the card turns over into the window (flipOpen). `blowing` is the card in the wind.
  const [blowing, setBlowing] = useState<string | null>(null);
  const [collectionFlip, setCollectionFlip] = useState<FlipFrom | null>(null);
  const blowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (blowTimer.current) clearTimeout(blowTimer.current);
  }, []);
  useEffect(() => {
    if (collectionOpen !== null) return;
    // Closed: the pictures are back on the card at once (the window still covers it), the turn is dropped after it.
    setBlowing(null);
    const spent = setTimeout(() => {
      setCollectionFlip(null);
      endFlip();
    }, 700);
    return () => clearTimeout(spent);
  }, [collectionOpen]);
  const blowOpen = (f: FolderEntry, kind: CollectionCardKind, event: import('react-native').GestureResponderEvent) => {
    if (blowing || !f.collection) return;
    const collection = f.collection;
    closeSearch();
    setBlowing(f.path);
    const flip = prepareFlip(`collection:${f.path}`, event);
    blowTimer.current = setTimeout(async () => {
      // A collection turns over quicker than a record (2026-10-19, the user's: faster, still seen).
      const turned = await flip;
      setCollectionFlip(turned ? { ...turned, ms: COLLECTION_FLIP_MS } : null);
      setCollectionOpen({ path: f.path, kind: collection });
    }, gustLeadMs(kind));
  };
  const collectionItems = useMemo(() => {
    if (!collectionOpen) return [];
    const { path: cp, kind } = collectionOpen;
    return items
      .filter((i) => (pathsOf.get(i.id) ?? []).includes(cp) && (kind === 'photo' ? i.kind === 'photo' : i.kind === 'link' && i.linkCategory === 'geo'))
      .sort((a, b) => Number(((b.raw ?? {}) as Record<string, unknown>).createdAt ?? 0) - Number(((a.raw ?? {}) as Record<string, unknown>).createdAt ?? 0));
  }, [collectionOpen, items, pathsOf]);
  const playlistVideos = useMemo<PlaylistVideo[]>(() => {
    if (playlistPath === null) return [];
    return items
      .filter((i) => i.kind === 'link' && i.linkCategory === 'video' && (pathsOf.get(i.id) ?? []).includes(playlistPath))
      .sort((a, b) => Number(((b.raw ?? {}) as Record<string, unknown>).createdAt ?? 0) - Number(((a.raw ?? {}) as Record<string, unknown>).createdAt ?? 0))
      .map(videoOf);
  }, [playlistPath, items, pathsOf]);
  // A folder's look: its icon and colour (every tag of its path), and its card (size, colour, pattern, text).
  const [lookTag, setLookTag] = useState<Tag | null>(null);
  const [cardTag, setCardTag] = useState<Tag | null>(null);
  const [sketching, setSketching] = useState<FolderItem | null>(null);
  const [foldersFor, setFoldersFor] = useState<FolderItem[] | null>(null);
  // «Завантажити» (a picture into the folder the user picked once): the shared
  // pieces, with the drawing burnt into the picture as the Photos base does.
  const { flatten: flattenPhoto, node: flattenPhotoNode } = useFlattenPhoto();
  const { downloadToast, showDownloadToast, dismissDownloadToast } = useDownloadToast();
  const [groups, setGroups] = useState<Group[]>([]);
  useEffect(
    () =>
      onSnapshot(
        ownedQuery('groups'),
        (snap) => setGroups(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) }) as Group)),
        listenError('ExplorerScreen:groups')
      ),
    []
  );
  // A short undo window after a delete, counted down in the open (the user:
  // «таймер при великій кількості»).
  const [toast, setToast] = useState<{ id: number; message: string; undo?: () => void; left: number } | null>(null);
  const toastId = toast?.id;
  useEffect(() => {
    if (toastId === undefined) return;
    const t = setInterval(() => setToast((cur) => (!cur ? null : cur.left <= 1 ? null : { ...cur, left: cur.left - 1 })), 1000);
    return () => clearInterval(t);
  }, [toastId]);

  // THE «+» (A1 of the remaining plan): the same fan as the projects window,
  // and what it makes lands in the folder being looked at.
  const [fanOpen, setFanOpen] = useState(false);
  // The quick-create window (features.quickCreate) - what the «+» opens now.
  const [quickOpen, setQuickOpen] = useState(false);
  // The window belongs to the explorer: when another screen comes in front (a base from the Mac's sidebar), it
  // closes rather than standing over that screen (seen 2026-10-19: «Нова нотатка» over the «Авто» list).
  useEffect(() => {
    if (!isFocused) setQuickOpen(false);
  }, [isFocused]);
  // «Новий» in the Mac's sidebar (navigation/explorerPlace).
  const createWanted = useExplorerCreateWanted();
  useEffect(() => {
    if (!createWanted || !isFocused) return;
    if (explorerPlace.takeCreate()) setQuickOpen(true);
  }, [createWanted, isFocused]);
  // WHAT WAS JUST MADE OPENS (the user, 2026-10-11: a new board/file/card did not open, the folder made
  // itself somewhere in the sort order and was hard to find): the record's id waits here until the
  // listener has it, then it is opened like a tap on it.
  const [justMade, setJustMade] = useState<string | null>(null);
  const create = useCreateFlow({ navigation, tagApi, groups, onCreated: (id) => setJustMade(id) });
  useEffect(() => {
    if (!justMade) return;
    const item = items.find((i) => i.docId === justMade);
    if (item) {
      setJustMade(null);
      openItem(item);
      return;
    }
    const t = setTimeout(() => setJustMade(null), 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justMade, items]);
  const folderPaths = useMemo(() => Array.from(new Set(tags.map((t) => t.path))).sort((a, b) => a.localeCompare(b)), [tags]);
  // The tag that stands for a folder path: an existing one, else a new UNIVERSAL one.
  async function tagForPath(folder: string): Promise<Tag> {
    // Never a folder of that name (see UNFILED): every writer goes through folderOf first.
    if (folder === UNFILED) throw new Error('«Нерозкладене» is not a folder');
    const same = tags.filter((t) => t.path === folder).sort((a, b) => b.types.length - a.types.length);
    if (same.length) return same[0];
    const color = '#DAA587';
    // Nothing ticked in «Де показувати» yet (2026-10-11): kinds are added as things are filed in it, or ticked
    // by hand (a playlist in the video base is the «YouTube / TikTok» tick).
    const id = await createFolderTag(folder, [], color);
    return { id, path: folder, icon: 'folder-outline', color, types: [], usedIn: {}, keep: true };
  }
  async function fanPick(key: string) {
    setFanOpen(false);
    if (key === 'folder') {
      setNaming('new');
      return;
    }
    try {
      const here = folderOf(path);
      await create.start(key as never, here ? await tagForPath(here) : null);
    } catch (e) {
      notify('Не збереглося', (e as Error).message);
    }
  }
  async function moveSelected(dest: string | null) {
    const chosen = pool.filter((i) => selected.has(i.id));
    if (chosen.length === 0 || dest === path) return;
    try {
      const into = folderOf(dest);
      const target = into ? await tagForPath(into) : null;
      for (const item of chosen) {
        if (folderOf(path)) {
          for (const tag of tags.filter((t) => t.path === path && item.tagIds.includes(t.id))) {
            await detachTag(tag, item.tagKind, item.docId, item.collection);
          }
        }
        if (target) await attachTag(target, item.tagKind, item.docId, item.collection);
      }
      setToast({ id: Date.now(), message: `Переміщено: ${chosen.length}`, left: 4 });
      leaveSelect();
    } catch (e) {
      notify('Не вдалося перемістити', (e as Error).message);
    }
  }
  async function pickAndMove() {
    const choice = await ask({
      title: `Перемістити (${selected.size}) в…`,
      actions: [
        ...(path ? [{ id: 'root', label: 'Без папки (корінь)', icon: 'home-outline' as const }] : []),
        { id: 'new', label: 'Нова папка…', icon: 'folder-open-outline' as const },
        ...folderPaths.filter((p) => p !== path).map((p) => ({ id: `p:${p}`, label: p.split('/').join(' › '), icon: 'folder-outline' as const })),
      ],
    });
    if (choice === 'cancel') return;
    if (choice === 'new') setNaming('move');
    else if (choice === 'root') await moveSelected(null);
    else if (choice.startsWith('p:')) await moveSelected(choice.slice(2));
  }
  // «Папки»: the things in SEVERAL folders at once. Starts from the folders ALL of
  // them already share; what is ticked is added to each, what was unticked is
  // taken from each. (A thing with a twin tag on one path is handled by path.)
  const sharedPaths = (list: FolderItem[]) => {
    if (list.length === 0) return [] as string[];
    const sets = list.map((i) => new Set(i.tagIds.map((id) => tagById.get(id)?.path).filter((p): p is string => !!p)));
    return Array.from(sets[0]).filter((p) => sets.every((st) => st.has(p)));
  };
  async function saveFolders(add: string[], remove: string[]) {
    const list = foldersFor ?? [];
    setFoldersFor(null);
    try {
      for (const folder of add) {
        const target = await tagForPath(folder);
        for (const item of list) {
          const already = tags.some((t) => t.path === folder && item.tagIds.includes(t.id));
          if (!already) await attachTag(target, item.tagKind, item.docId, item.collection);
        }
      }
      for (const folder of remove) {
        for (const item of list) {
          for (const tag of tags.filter((t) => t.path === folder && item.tagIds.includes(t.id))) {
            await detachTag(tag, item.tagKind, item.docId, item.collection);
          }
        }
      }
      setToast({ id: Date.now(), message: 'Папки оновлено', left: 3 });
      leaveSelect();
    } catch (e) {
      notify('Не вдалося', (e as Error).message);
    }
  }
  // «Проєкт» for the whole choice (the user's spelling, 2026-10-10): one list of
  // projects, whatever kinds were chosen; a project that did not yet show in a
  // kind's base gains that kind, so the thing is seen there under it.
  async function assignProject() {
    const chosen = pool.filter((i) => selected.has(i.id));
    if (chosen.length === 0) return;
    const live = groups.filter((g) => !g.archived).sort((a, b) => a.name.localeCompare(b.name));
    const choice = await ask({
      title: `Проєкт для (${chosen.length})`,
      actions: [
        { id: 'none', label: 'Без проєкту', icon: 'remove-circle-outline' as const },
        ...live.map((g) => ({ id: `g:${g.id}`, label: g.name, icon: 'albums-outline' as const })),
      ],
    });
    if (choice === 'cancel') return;
    try {
      const group = choice.startsWith('g:') ? live.find((g) => g.id === choice.slice(2)) ?? null : null;
      await Promise.all(
        chosen.map((i) => updateDoc(doc(db, i.collection, i.docId), { groupId: group ? group.id : deleteField() }))
      );
      if (group) {
        const missing = Array.from(new Set(chosen.map((i) => i.tagKind))).filter((k) => !kindsOf(group).includes(k));
        if (missing.length) await updateDoc(doc(db, 'groups', group.id), { kinds: arrayUnion(...missing) });
      }
      setToast({ id: Date.now(), message: group ? `Проєкт «${group.name}»: ${chosen.length}` : `Без проєкту: ${chosen.length}`, left: 4 });
      leaveSelect();
    } catch (e) {
      notify('Не вдалося', (e as Error).message);
    }
  }
  // «Перейменувати» for ONE thing: the field its own base calls the name.
  async function renameOne(name: string) {
    const item = renaming;
    setRenaming(null);
    const clean = name.trim();
    if (!item || !clean) return;
    const field = item.kind === 'flashcard' ? 'term' : 'title';
    try {
      await updateDoc(doc(db, item.collection, item.docId), { [field]: clean });
      leaveSelect();
    } catch (e) {
      notify('Не вдалося перейменувати', (e as Error).message);
    }
  }
  // A PHOTO / VIDEO / GEO POINT / LINK in the explorer is a REFERENCE to the record of its base (the user,
  // 2026-10-11): «delete» takes it out of the folder and the original stays in its base. (In the bin and the
  // cleanup view the record itself is meant.)
  const isReference = (i: FolderItem) => FEATURES.explorerFiledOnly && !inBin && !inCleanup && (i.kind === 'photo' || i.kind === 'link');
  // The folder tags a reference hangs on here: those of the folder being looked at, else all of them (search).
  function referenceTags(i: FolderItem): Tag[] {
    const mine = i.tagIds.map((id) => tagById.get(id)).filter((t): t is Tag => !!t);
    const here = path ? mine.filter((t) => t.path === path) : [];
    return here.length > 0 ? here : mine;
  }
  async function deleteSelected() {
    const chosen = pool.filter((i) => selected.has(i.id));
    // Everything the explorer shows has a bin now (boards and cards since 2026-10-11:
    // `deletedAt`, ignored by every reader through utils/isGone). Records of a personal
    // database never reach this list.
    const refs = chosen.filter(isReference);
    chosen.splice(0, chosen.length, ...chosen.filter((i) => !isReference(i)));
    const binnable = chosen.filter((i) => i.kind !== 'row');
    const skipped = chosen.length - binnable.length;
    if (refs.length > 0) {
      const taken: { tag: Tag; item: FolderItem }[] = [];
      for (const r of refs) {
        for (const t of referenceTags(r)) {
          taken.push({ tag: t, item: r });
          await detachTag(t, r.tagKind, r.docId, r.collection).catch(() => {});
        }
      }
      const at = Date.now();
      setToast({
        id: at,
        message: refs.length === 1 ? 'Прибрано з папки (оригінал лишився в базі)' : `Прибрано з папки: ${refs.length} (оригінали лишились у базі)`,
        left: 10,
        undo: () => {
          taken.forEach(({ tag, item }) => attachTag(tag, item.tagKind, item.docId, item.collection).catch(() => {}));
          setToast(null);
        },
      });
      if (binnable.length === 0) {
        leaveSelect();
        return;
      }
    }
    if (binnable.length === 0) return;
    // «ЩО ЛИШИТИ?» (the user, 2026-10-09: no litter): a board is mostly references to photos, links, notes
    // that are records of their own - ask which of them go with it (utils/deletionPlan).
    let alsoRemove: PlanItem[] = [];
    const boardsGoing = binnable.filter((i) => i.kind === 'board' && !inBin);
    if (FEATURES.deleteAsksContents && boardsGoing.length > 0) {
      try {
        const asBoard = (i: FolderItem): BoardItem => {
          const r = (i.raw ?? {}) as Record<string, unknown>;
          return { id: i.docId, title: i.title, cards: readBoardPart<BoardCard>(r.cards), columns: readBoardPart<BoardColumn>(r.columns) } as BoardItem;
        };
        const everyBoard = items.filter((i) => i.kind === 'board').map(asBoard);
        const plan = await describeBoards(boardsGoing.map(asBoard), everyBoard);
        if (plan.groups.length > 0) {
          const answer = await askWhatToKeep({
            title: boardsGoing.length === 1 ? 'Видалити дошку?' : `Видалити дошки (${boardsGoing.length})?`,
            subtitle: boardsGoing.map((b) => b.title || 'Без назви').join(', '),
            noun: boardsGoing.length === 1 ? 'дошки' : 'дощок',
            plan,
            withIt: boardsGoing.length === 1 ? 'нею' : 'ними',
            place: boardsGoing.length === 1 ? 'цій дошці' : 'цих дошках',
          });
          if (!answer) return;
          alsoRemove = answer;
        }
      } catch (e) {
        console.warn('describeBoards', e);
      }
    }
    const now = Date.now();
    await Promise.all(
      binnable.map((i) => (i.kind === 'document' ? binNote(i.docId) : updateDoc(doc(db, i.collection, i.docId), { deletedAt: now }))).map((p) => p.catch(() => {}))
    );
    if (alsoRemove.length > 0) await removeItems(alsoRemove);
    setToast({
      id: now,
      message: `Видалено: ${binnable.length}${skipped ? ` (${skipped} дошок/карток лишилось)` : ''}`,
      left: 10,
      undo: () => {
        binnable.forEach((i) => {
          (i.kind === 'document' ? restoreNote(i.docId) : updateDoc(doc(db, i.collection, i.docId), { deletedAt: deleteField() })).catch(() => {});
        });
        setToast(null);
      },
    });
    leaveSelect();
  }
  // A hold can choose «Перемістити»/«Видалити» for a single card: it first marks it chosen,
  // and the NEXT render's functions (which see that choice) must run - hence the refs.
  const folderHeld = useRef(false);
  const pickAndMoveRef = useRef<() => void>(() => {});
  const deleteSelectedRef = useRef<() => void>(() => {});
  async function makeFolder(name: string, thenMove: boolean) {
    const clean = name.trim().replace(/\//g, '-');
    if (!clean) return;
    const full = folderOf(path) ? `${path}/${clean}` : clean;
    try {
      await tagForPath(full);
      if (thenMove) await moveSelected(full);
      // A new folder is OPENED: otherwise it stands somewhere in the sort order and is lost.
      if (!thenMove) setPath(full);
    } catch (e) {
      notify('Не вдалося створити папку', (e as Error).message);
    }
  }
  pickAndMoveRef.current = pickAndMove;
  deleteSelectedRef.current = deleteSelected;
  // A FOLDER HELD: rename, or delete (the user's rule for a deleted folder: what lay in it
  // is NOT lost - it goes to the root, and subfolders go with the folder).
  // One hold, one menu: a held card is heard both by its own long press and by the carry's hold, and the second
  // menu waited under the first and came back after «Вигляд картки» was done (2026-10-12).
  async function holdFolder(f: FolderEntry) {
    // The Finder rule (Mac): a right click CHOOSES the card first, then asks.
    if (explorerSelect) {
      chosenOpen.current = () => openFolderEntry(f);
      setChosen(`folder:${f.path}`);
    }
    // «Нерозкладене» is not a folder: nothing to rename, colour, move or delete.
    if (f.path === UNFILED) return;
    if (folderHeld.current) return;
    folderHeld.current = true;
    try {
      await holdFolderMenu(f);
    } finally {
      folderHeld.current = false;
    }
  }
  async function holdFolderMenu(f: FolderEntry) {
    // A BASE'S COLLECTION placed here (2026-10-15): it has no icon or colour of its own (its face is its content), it can
    // be taken back out of the explorer - it stays in its base - and deleting it deletes the collection itself.
    const coll = !!f.collection;
    const choice = await ask({
      title: f.name,
      actions: [
        { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' as const },
        { id: 'move', label: 'Перемістити в…', icon: 'arrow-forward-outline' as const },
        ...(coll ? [] : [{ id: 'look', label: 'Іконка й колір', icon: 'color-palette-outline' as const }]),
        { id: 'card', label: 'Вигляд картки', icon: 'albums-outline' as const },
        ...(FEATURES.explorerProjects && !coll ? [{ id: 'projects', label: 'Проєкти…', icon: 'folder-open-outline' as const }] : []),
        ...(coll ? [{ id: 'unplace', label: 'Прибрати з провідника', icon: 'eye-off-outline' as const }] : []),
        { id: 'delete', label: coll ? 'Видалити підбірку' : 'Видалити папку', icon: 'trash-outline' as const, tone: 'danger' as const },
      ],
    });
    if (choice === 'unplace') {
      await tagApi.removeFromExplorer([f.path]).catch(() => {});
      return;
    }
    if (choice === 'delete' && coll) {
      const yes = await confirm({
        title: `Видалити підбірку «${f.name}»?`,
        message: `Підбірка зникне і з провідника, і з бази. ${f.count > 0 ? `${f.count} речей у ній лишаться в базі.` : ''}`.trim(),
        confirmLabel: 'Видалити підбірку',
      });
      if (!yes) return;
      try {
        for (const tag of tags.filter((t) => t.path === f.path || t.path.startsWith(`${f.path}/`))) await deleteTagCompletely(tag);
      } catch (e) {
        notify('Не вдалося видалити', (e as Error).message);
      }
      return;
    }
    if (choice === 'rename') setRenamingFolder(f);
    else if (choice === 'projects') {
      try {
        setProjectsFor(await tagForPath(f.path));
      } catch (e) {
        notify('Не вдалося відкрити', (e as Error).message);
      }
    } else if (choice === 'look' || choice === 'card') {
      // A folder shown only through the folders under it has no tag of its own yet: make it.
      try {
        const rep = await tagForPath(f.path);
        if (choice === 'look') setLookTag(rep);
        else setCardTag(rep);
      } catch (e) {
        notify('Не вдалося відкрити', (e as Error).message);
      }
    } else if (choice === 'move') {
      const dest = await ask({
        title: `«${f.name}» перемістити в…`,
        actions: [
          { id: 'root', label: 'У корінь (без папки)', icon: 'home-outline' as const },
          ...folderPaths.filter((p) => p !== f.path && !p.startsWith(`${f.path}/`)).map((p) => ({ id: `p:${p}`, label: p.split('/').join(' › '), icon: 'folder-outline' as const })),
        ],
      });
      if (dest === 'cancel') return;
      await moveFolderTo(f.path, dest === 'root' ? null : dest.slice(2)).catch(() => {});
    } else if (choice === 'delete') {
      const yes = await confirm({
        title: `Видалити папку «${f.name}»?`,
        message: f.count > 0 ? `Папка зникне, а ${f.count} речей у ній підуть у корінь (нічого не видаляється).` : 'Папка порожня.',
        confirmLabel: 'Видалити папку',
      });
      if (!yes) return;
      try {
        for (const tag of tags.filter((t) => t.path === f.path || t.path.startsWith(`${f.path}/`))) {
          await deleteTagCompletely(tag);
        }
      } catch (e) {
        notify('Не вдалося видалити папку', (e as Error).message);
      }
    }
  }
  async function renameFolderTo(name: string) {
    const f = renamingFolder;
    setRenamingFolder(null);
    const clean = name.trim().replace(/\//g, '-');
    if (!f || !clean) return;
    const parent = f.path.split('/').slice(0, -1).join('/');
    const next = parent ? `${parent}/${clean}` : clean;
    if (next === f.path) return;
    try {
      // The whole branch follows, with or without a tag of the folder's own.
      const changed = await moveBranch(f.path, next);
      if (changed === 0) throw new Error('Папку не вдалося знайти.');
    } catch (e) {
      notify('Не вдалося перейменувати папку', (e as Error).message);
    }
  }

  // THE BIN's two moves. Restore = the stamp removed (a note with the notes under it, restoreNote).
  // Remove for good = the record deleted and the folders it was in forget it; a copy of a
  // picture or file on Google Диск is NOT touched (nothing here deletes the user's Drive).
  async function restoreSelected() {
    const chosen = binned.filter((i) => selected.has(i.id));
    if (chosen.length === 0) return;
    try {
      await Promise.all(
        chosen.map((i) => (i.kind === 'document' ? restoreNote(i.docId) : updateDoc(doc(db, i.collection, i.docId), { deletedAt: deleteField() })))
      );
      setToast({ id: Date.now(), message: `Відновлено: ${chosen.length}`, left: 4 });
      setSelected(new Set());
    } catch (e) {
      notify('Не вдалося відновити', (e as Error).message);
    }
  }
  async function purgeOneItem(i: FolderItem) {
    for (const tagId of i.tagIds) {
      const tag = tagById.get(tagId);
      if (tag) await detachTagFromDeletedItem(tag, i.tagKind, i.docId).catch(() => {});
    }
    await deleteDoc(doc(db, i.collection, i.docId));
  }
  async function purgeSelected() {
    const chosen = binned.filter((i) => selected.has(i.id));
    if (chosen.length === 0) return;
    const yes = await confirm({
      title: `Видалити назавжди (${chosen.length})?`,
      message: 'Це не можна скасувати. Копії на Google Диску не чіпаю.',
      confirmLabel: 'Видалити назавжди',
    });
    if (!yes) return;
    try {
      for (const i of chosen) {
        if (i.kind === 'document') {
          await purgeNote(i.docId, async (id) => {
            const snap = await getDoc(doc(db, 'documents', id));
            if (!snap.exists()) return;
            for (const tagId of (snap.data()?.tagIds as string[] | undefined) ?? []) {
              const tag = tagById.get(tagId);
              if (tag) await detachTagFromDeletedItem(tag, 'document', id).catch(() => {});
            }
            await deleteDoc(doc(db, 'documents', id));
          });
        } else await purgeOneItem(i);
      }
      setToast({ id: Date.now(), message: `Видалено назавжди: ${chosen.length}`, left: 3 });
      setSelected(new Set());
    } catch (e) {
      notify('Не вдалося видалити', (e as Error).message);
    }
  }
  // THE 30-DAY RULE for boards and cards (the bases that have their own bin already clear
  // theirs): whatever has lain in the bin longer is removed for good, once per visit.
  const purgedOld = useRef(false);
  useEffect(() => {
    if (purgedOld.current || binned.length === 0) return;
    purgedOld.current = true;
    const cutoff = Date.now() - BIN_TTL_MS;
    const old = binned.filter((i) => (i.kind === 'board' || i.kind === 'flashcard') && Number((i.raw as Record<string, unknown>).deletedAt) < cutoff);
    old.forEach((i) => purgeOneItem(i).catch(() => {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binned]);
  const enterBin = () => {
    setInBin(true);
    setSelecting(true);
    setSelected(new Set());
  };
  const enterCleanup = () => {
    setInCleanup(true);
    setSelecting(true);
    setSelected(new Set());
  };
  const leaveCleanup = () => {
    setInCleanup(false);
    leaveSelect();
  };
  // The task leftovers go to the bin by themselves, once per visit, with a way back.
  const autoCleaned = useRef(false);
  useEffect(() => {
    if (autoCleaned.current) return;
    const mine = candidates.filter((c) => c.auto);
    if (mine.length === 0) return;
    autoCleaned.current = true;
    const now = Date.now();
    Promise.all(mine.map((c) => updateDoc(doc(db, c.item.collection, c.item.docId), { deletedAt: now, autoBinned: true }).catch(() => {}))).then(() => {
      setToast({
        id: now,
        message: `Прибрано вкладень закритих справ: ${mine.length}`,
        left: 10,
        undo: () => {
          mine.forEach((c) => updateDoc(doc(db, c.item.collection, c.item.docId), { deletedAt: deleteField(), autoBinned: deleteField(), keep: true }).catch(() => {}));
          setToast(null);
        },
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);
  const leaveBin = () => {
    setInBin(false);
    leaveSelect();
  };

  // A NEW SHORTCUT, in the folder being looked at (or the root). Three kinds to begin with:
  // a TABLE of a personal database (with one of its saved views, if wanted), one PROJECT's
  // tasks, a COLLECTION of links (a kind, optionally narrowed to a folder). What it holds is
  // only «what to open and how»; nothing is copied.
  async function newShortcut() {
    const kind = await ask({
      title: 'Новий ярлик',
      actions: [
        { id: 'database', label: 'Таблиця бази', icon: 'grid-outline' as const },
        { id: 'tasks', label: 'Справи проєкту', icon: 'checkbox-outline' as const },
        { id: 'links', label: 'Підбірка посилань', icon: 'link-outline' as const },
      ],
    });
    if (kind === 'cancel') return;
    let source: ShortcutSource = kind as ShortcutSource;
    let params: ShortcutParams = {};
    let title = '';
    let subtitle = '';
    try {
      if (source === 'database') {
        const snap = await getDocs(ownedQuery('customDatabases'));
        const dbs = snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) || 'Без назви' })).sort((a, b) => a.name.localeCompare(b.name));
        if (dbs.length === 0) return notify('Баз ще нема', 'Створіть власну базу в «Базах».');
        const pickedDb = await ask({ title: 'Яка таблиця?', actions: dbs.map((d) => ({ id: d.id, label: d.name, icon: 'grid-outline' as const })) });
        if (pickedDb === 'cancel') return;
        const db0 = dbs.find((d) => d.id === pickedDb);
        params = { databaseId: pickedDb };
        title = db0?.name ?? 'Таблиця';
        subtitle = 'таблиця';
        const viewsSnap = await getDocs(ownedQuery('customDatabaseViews'));
        const views = viewsSnap.docs.filter((d) => d.data().databaseId === pickedDb).map((d) => ({ id: d.id, name: (d.data().name as string) || 'Вигляд' }));
        if (views.length > 0) {
          const pickedView = await ask({
            title: 'Який вигляд?',
            actions: [{ id: 'none', label: 'Як вона зараз', icon: 'grid-outline' as const }, ...views.map((v) => ({ id: v.id, label: v.name, icon: 'funnel-outline' as const }))],
          });
          if (pickedView === 'cancel') return;
          if (pickedView !== 'none') {
            params.openViewId = pickedView;
            const vn = views.find((v) => v.id === pickedView)?.name;
            subtitle = `таблиця · ${vn}`;
            title = `${title} · ${vn}`;
          }
        }
      } else if (source === 'tasks') {
        const live = groups.filter((g) => !g.archived).sort((a, b) => a.name.localeCompare(b.name));
        const pickedGroup = await ask({
          title: 'Справи якого проєкту?',
          actions: [{ id: 'all', label: 'Усі справи', icon: 'checkbox-outline' as const }, ...live.map((g) => ({ id: `g:${g.id}`, label: g.name, icon: 'albums-outline' as const }))],
        });
        if (pickedGroup === 'cancel') return;
        if (pickedGroup === 'all') {
          title = 'Справи';
          subtitle = 'усі справи';
        } else {
          const g = live.find((x) => x.id === pickedGroup.slice(2));
          params = { projectId: pickedGroup.slice(2) };
          title = `Справи · ${g?.name ?? ''}`;
          subtitle = `справи проєкту «${g?.name ?? ''}»`;
        }
      } else {
        const cat = await ask({
          title: 'Які посилання?',
          actions: [
            { id: 'video', label: 'Відео (YouTube, TikTok)', icon: 'videocam-outline' as const },
            { id: 'geo', label: 'Геоточки', icon: 'location-outline' as const },
            { id: 'other', label: 'Посилання', icon: 'link-outline' as const },
          ],
        });
        if (cat === 'cancel') return;
        const catLabel = cat === 'video' ? 'Відео' : cat === 'geo' ? 'Геоточки' : 'Посилання';
        params = { category: cat as 'video' | 'geo' | 'other' };
        title = catLabel;
        subtitle = catLabel.toLowerCase();
        const pickedFolder = await ask({
          title: 'З якої папки?',
          actions: [{ id: 'all', label: 'З усіх', icon: 'home-outline' as const }, ...folderPaths.map((p) => ({ id: `p:${p}`, label: p.split('/').join(' › '), icon: 'folder-outline' as const }))],
        });
        if (pickedFolder === 'cancel') return;
        if (pickedFolder !== 'all') {
          const fp = pickedFolder.slice(2);
          params.folderPath = fp;
          title = `${catLabel} · ${nameOf(fp)}`;
          subtitle = `${catLabel.toLowerCase()} з папки «${fp.split('/').join(' › ')}»`;
        }
      }
      const now = Date.now();
      const ref = await addDoc(collection(db, 'shortcuts'), { title, subtitle, source, params, tagIds: [], createdAt: now, updatedAt: now });
      if (folderOf(path)) await attachTag(await tagForPath(path), 'shortcut', ref.id, 'shortcuts');
      setToast({ id: now, message: `Ярлик «${title}» створено`, left: 4 });
    } catch (e) {
      notify('Не вдалося створити ярлик', (e as Error).message);
    }
  }

  // CARRYING (the explorer's own drag, like the bases': hold a card ~0.65 s, lift it, let go over a folder
  // - or over a crumb with the second finger). FOLDERS are carried too, into another folder.
  // A folder is a pseudo-item here: id `folder:<path>`, its path in `folderPath`.
  type Carried = FolderItem & { folderPath?: string };
  const folderItem = (f: FolderEntry): Carried =>
    ({ id: `folder:${f.path}`, docId: f.path, kind: 'shortcut' as FolderItemKind, tagKind: 'folder', collection: 'tags', tagIds: [], title: f.name, folderPath: f.path }) as Carried;
  const lastDest = useRef(new Map<string, string | null>());
  // Moves a folder (and everything under it) to `destination`. A refusal says why and THROWS, so a
  // caller never reports a move that did not happen (the carry's «Переміщено» toast did, 2026-10-11).
  async function moveFolderTo(from: string, destination: string | null) {
    const name = nameOf(from);
    const next = destination ? `${destination}/${name}` : name;
    if (next === from) throw new Error('same-place');
    const refuse = (title: string, message: string): never => {
      notify(title, message);
      throw new Error('refused');
    };
    // Not into itself or anything inside it.
    if (destination && (destination === from || destination.startsWith(`${from}/`))) {
      refuse('Так не можна', 'Папку не можна покласти саму в себе чи у свою підпапку.');
    }
    if (tags.some((t) => t.path === next || t.path.startsWith(`${next}/`))) {
      refuse('Така папка вже є', `У цьому місці вже є папка «${name}».`);
    }
    // By the path, not by a tag of that exact path: a folder may exist only through the tags under it.
    let changed = 0;
    try {
      changed = await moveBranch(from, next);
    } catch (e) {
      refuse('Не вдалося перенести', (e as Error).message);
    }
    if (changed === 0) refuse('Не вдалося перенести', `Папку «${name}» не знайдено серед збережених папок.`);
  }
  async function moveCarried(item: Carried, dropped: string | null) {
    // Dropped on «Нерозкладене»: out of its folder, into none.
    const destination = folderOf(dropped);
    if (item.folderPath) {
      const from = item.folderPath;
      await moveFolderTo(from, destination);
      const moved = destination ? `${destination}/${nameOf(from)}` : nameOf(from);
      // The alias answers to the OLD id and, when moved again (undo), goes where the folder now is.
      setFolderAliases((prev) => [...prev.filter((a) => a.id !== `folder:${from}`), { ...folderItem({ path: moved, name: nameOf(moved), count: 0 } as FolderEntry), id: `folder:${from}` }]);
      return;
    }
    const paths = (item.tagIds ?? []).map((id) => tagById.get(id)?.path);
    const from = folderOf(path) && paths.includes(path) ? path : (lastDest.current.get(item.id) ?? null);
    if (from) {
      for (const tag of tags.filter((t) => t.path === from && item.tagIds.includes(t.id))) {
        await detachTag(tag, item.tagKind, item.docId, item.collection);
      }
    }
    if (destination) {
      const target = await tagForPath(destination);
      await attachTag(target, item.tagKind, item.docId, item.collection);
    }
    lastDest.current.set(item.id, destination);
  }
  // UNDO of a folder move: the carry looks the moved things up by id, and a moved folder's old id
  // (`folder:<old path>`) no longer names anything - so each move leaves an alias under that id that
  // points at the folder's NEW path, and undoing it moves it back.
  const [folderAliases, setFolderAliases] = useState<Carried[]>([]);
  const carryItems = useMemo<Carried[]>(() => [...items, ...folders.map(folderItem), ...folderAliases], [items, folders, folderAliases]);
  const carrying = useExplorerCarry<Carried>({
    path,
    folders: folders.map((f) => ({ fullPath: f.path, name: f.name })),
    moveItem: moveCarried,
    items: carryItems,
    isSelectMode: selecting,
    selectedIds: selected,
    onMoved: () => {
      if (selecting) leaveSelect();
    },
    active: !inBin && !inCleanup,
  });
  const scrollY = useSharedValue(0);
  carrying.scrollYRef.current = scrollY;

  // A CARD HELD (the one menu for every kind - the shared set of the survey, 2026-10-10):
  // the card lifts over the blur like everywhere (holdAsk), then the same rows whatever
  // it is; «Поділитись» only where the kind has something to share.
  async function shareItem(item: FolderItem) {
    const raw = (item.raw ?? {}) as Record<string, unknown>;
    try {
      if (item.kind === 'photo') await shareImageFile(raw.imageUri as string, raw.driveFileId as string | undefined, item.title);
      else if (item.kind === 'link') await Share.share({ message: item.title ? `${item.title}\n${raw.url as string}` : (raw.url as string) });
      else if (item.kind === 'file')
        await shareFile({ fileUri: raw.fileUri as string, fileName: (raw.fileName as string) ?? item.title, mimeType: raw.mimeType as string | undefined, driveFileId: raw.driveFileId as string | undefined });
    } catch (e) {
      notify('Не вдалося поділитись', (e as Error).message);
    }
  }
  async function holdItem(item: FolderItem) {
    if (explorerSelect) {
      chosenOpen.current = () => openItem(item);
      setChosen(item.id);
    }
    const canShare = item.kind === 'photo' || item.kind === 'link' || item.kind === 'file';
    const canBin = item.kind !== 'row';
    const choice = await holdAsk({
      title: item.title,
      actions: [
        { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' as const },
        { id: 'folders', label: 'Папки', icon: 'pricetag-outline' as const },
        { id: 'move', label: 'Перемістити в…', icon: 'arrow-forward-outline' as const },
        ...(canShare ? [{ id: 'share', label: 'Поділитись', icon: 'share-social-outline' as const }] : []),
        { id: 'select', label: 'Вибрати', icon: 'checkmark-circle-outline' as const },
        ...(canBin ? [{ id: 'delete', label: isReference(item) ? 'Прибрати з папки' : 'Видалити', icon: 'trash-outline' as const, tone: 'danger' as const }] : []),
      ],
    });
    if (choice === 'rename') setRenaming(item);
    else if (choice === 'folders') setFoldersFor([item]);
    else if (choice === 'share') shareItem(item);
    else if (choice === 'select') {
      setSelecting(true);
      setSelected(new Set([item.id]));
    } else if (choice === 'move') {
      setSelecting(true);
      setSelected(new Set([item.id]));
      setTimeout(() => pickAndMoveRef.current(), 80);
    } else if (choice === 'delete') {
      setSelecting(true);
      setSelected(new Set([item.id]));
      setTimeout(() => deleteSelectedRef.current(), 80);
    }
  }

  useTopExtras(
    // On the Mac (frame B) the panel beside the list says all of this as live controls (ExplorerPanel).
    explorerSelect ? null : [
      // The shared set of the bases' «⋯» (the survey of 2026-10-10): the view, the order, then the folder.
      ...viewSection(viewMode, (m) => changeView(m), ['list', 'grid', 'canvas']),
      ...orderSection(sortPref, selectSortField),
      { label: 'Групувати за типом', icon: 'layers-outline' as const, checked: byKind, onPress: toggleByKind },
      { label: 'Фільтри (тип, проєкт)', icon: 'filter-outline' as const, checked: chipsOn, onPress: toggleChips },
      { kind: 'section' as const, label: 'Стиль провідника' },
      { label: 'Чистий', icon: 'reorder-two-outline' as const, checked: explorerStyle === 'clean', onPress: () => changeStyle('clean') },
      { label: 'Модерний', icon: 'albums-outline' as const, checked: explorerStyle === 'modern', onPress: () => changeStyle('modern') },
      ...(FEATURES.explorerProjects ? [{ label: 'Проєкти', icon: 'folder-open-outline' as const, checked: explorerStyle === 'projects', onPress: () => changeStyle('projects') }] : []),
      { kind: 'rule' as const },
      ...(candidates.length > 0
        ? [{ label: `Кандидати на очищення (${candidates.length})`, icon: 'sparkles-outline' as const, onPress: enterCleanup }]
        : []),
      ...(history.current.at > 0
        ? [{ label: `Назад: ${folderLabel(history.current.stack[history.current.at - 1])}`, icon: 'arrow-back-outline' as const, onPress: () => goHistory(-1) }]
        : []),
      ...(history.current.at < history.current.stack.length - 1
        ? [{ label: `Уперед: ${folderLabel(history.current.stack[history.current.at + 1])}`, icon: 'arrow-forward-outline' as const, onPress: () => goHistory(1) }]
        : []),
      { label: 'Нова папка', icon: 'folder-open-outline' as const, onPress: () => setNaming('new') },
      { label: 'Новий ярлик…', icon: 'rocket-outline' as const, onPress: () => newShortcut() },
    ],
    { active: selecting, onPress: () => (selecting ? leaveSelect() : setSelecting(true)) },
    // The phone's top bar, or the Mac's window toolbar (frame B) - without the second the whole «⋯» of the start
    // (view, order, style, cleanup, new folder…) had no door on the Mac (the user, 2026-10-19).
    isFocused && (topNavOn || (FEATURES.macFrameB && Platform.OS === 'web')) && !inPane
  );
  useDockActions(
    isFocused && inBin
      ? [
          { key: 'cancel', icon: 'close-outline', label: 'Вийти', onPress: leaveBin },
          binned.length > 0 && binned.every((i) => selected.has(i.id))
            ? { key: 'none', icon: 'remove-circle-outline', label: 'Зняти всі', onPress: () => setSelected(new Set()) }
            : { key: 'all', icon: 'checkmark-done-outline', label: 'Вибрати всі', onPress: () => setSelected(new Set(binned.map((i) => i.id))) },
          ...(selected.size > 0
            ? [
                { key: 'restore', icon: 'arrow-undo-outline', label: 'Відновити', onPress: restoreSelected },
                { key: 'purge', icon: 'trash-outline', label: 'Назавжди', onPress: purgeSelected },
              ]
            : []),
        ]
      : isFocused && selecting
      ? selectionDock({
          onExit: leaveSelect,
          all: {
            shown: here.length,
            chosen: here.filter((i) => selected.has(i.id)).length,
            onAll: () => setSelected(new Set(here.map((i) => i.id))),
            onNone: () => setSelected(new Set()),
          },
          count: selected.size,
          move: pickAndMove,
          tag: () => setFoldersFor(pool.filter((i) => selected.has(i.id))),
          group: assignProject,
          rename: selected.size === 1 ? () => setRenaming(pool.find((i) => selected.has(i.id)) ?? null) : undefined,
          share:
            selected.size === 1 && ['photo', 'link', 'file'].includes(pool.find((i) => selected.has(i.id))?.kind ?? '')
              ? () => {
                  const it = pool.find((i) => selected.has(i.id));
                  if (it) shareItem(it);
                }
              : undefined,
          remove: deleteSelected,
          removeLabel: pool.filter((i) => selected.has(i.id)).length > 0 && pool.filter((i) => selected.has(i.id)).every(isReference) ? 'Прибрати' : undefined,
        })
      : null
  );

  // The picture's own actions, as the Photos base's viewer has them (the viewer
  // closes itself before any of them runs - see ZoomableImageViewer).
  function viewerActions(item: FolderItem): ViewerAction[] {
    const raw = (item.raw ?? {}) as Record<string, unknown>;
    const uri = raw.imageUri as string;
    const drive = typeof raw.driveFileId === 'string' ? raw.driveFileId : undefined;
    return [
      { key: 'rename', icon: 'pencil-outline', label: 'Назва', onPress: () => setRenaming(item) },
      { key: 'folders', icon: 'pricetag-outline', label: 'Папки', onPress: () => setFoldersFor([item]) },
      {
        key: 'download',
        icon: 'download-outline',
        label: 'Завантажити',
        onPress: async () => {
          try {
            const flat = await flattenPhoto(uri, drive, raw.sketchElements as never, raw.sketchWidth as never, raw.sketchHeight as never);
            const result = await downloadToFolder(flat, `photo-${Date.now()}.jpg`, 'image/jpeg', drive);
            if (result) showDownloadToast(result.fileName, result.destUri, 'image/jpeg');
          } catch (e) {
            notify('Не вдалося завантажити', (e as Error).message);
          }
        },
      },
      {
        key: 'document',
        icon: 'document-text-outline',
        label: 'Документ',
        badge: Object.keys((raw.usedInDocuments as Record<string, boolean>) ?? {}).length,
        onPress: () => openUsedIn(item),
      },
      { key: 'draw', icon: 'brush-outline', label: 'Малювати', onPress: () => setSketching(item) },
      { key: 'share', icon: 'share-social-outline', label: 'Поділитись', onPress: () => shareImageFile(uri, drive, item.title) },
      { key: 'copy', icon: 'copy-outline', label: 'Копіювати', onPress: () => copyImageFile(uri, drive) },
      {
        key: 'delete',
        icon: 'trash-outline',
        label: isReference(item) ? 'Прибрати з папки' : 'Видалити',
        color: '#F87171',
        onPress: () => {
          if (isReference(item)) {
            const taken = referenceTags(item);
            taken.forEach((t) => detachTag(t, item.tagKind, item.docId, item.collection).catch(() => {}));
            setToast({
              id: Date.now(),
              message: 'Прибрано з папки (оригінал лишився в базі)',
              left: 10,
              undo: () => {
                taken.forEach((t) => attachTag(t, item.tagKind, item.docId, item.collection).catch(() => {}));
                setToast(null);
              },
            });
            return;
          }
          const now = Date.now();
          updateDoc(doc(db, item.collection, item.docId), { deletedAt: now }).catch(() => {});
          setToast({
            id: now,
            message: 'Зображення видалено',
            left: 10,
            undo: () => {
              updateDoc(doc(db, item.collection, item.docId), { deletedAt: deleteField() }).catch(() => {});
              setToast(null);
            },
          });
        },
      },
    ];
  }

  // «Документ»: the notes that hold this thing - straight in when one, a list when several.
  async function openUsedIn(item: FolderItem) {
    const ids = Object.keys((((item.raw ?? {}) as Record<string, unknown>).usedInDocuments as Record<string, boolean>) ?? {});
    if (ids.length === 0) {
      notify('Ще ніде не використано', 'Це зображення не вставлене в жодну нотатку.');
      return;
    }
    if (ids.length === 1) {
      (navigation as unknown as { navigate: (n: string, p: object) => void }).navigate('Editor', { documentId: ids[0] });
      return;
    }
    const docs = await Promise.all(
      ids.map(async (id) => ({ id, title: ((await getDoc(doc(db, 'documents', id))).data()?.title as string) || 'Без назви' }))
    );
    const choice = await ask({ title: 'У яких нотатках', actions: docs.map((d) => ({ id: d.id, label: d.title, icon: 'document-text-outline' as const })) });
    if (choice !== 'cancel') (navigation as unknown as { navigate: (n: string, p: object) => void }).navigate('Editor', { documentId: choice });
  }

  // Up from a folder that stands straight under a PROJECT ROOT leaves to the project's level, not into the root folder itself.
  const focusRootsRef = useRef<string[]>([]);
  focusRootsRef.current = focusRoots;
  const upPlain = useCallback(
    () =>
      setPath((p) => {
        const parent = p.split('/').slice(0, -1).join('/');
        return parent && focusRootsRef.current.includes(parent) ? '' : parent;
      }),
    []
  );
  // Up one level - in «Модерний» the folder folds back into its card on the way (FolderShrink).
  const up = () => {
    const tag = (explorerStyle === 'modern' || explorerStyle === 'projects') && path ? cardTagOf(path) : undefined;
    if (tag && !inBin && !inCleanup) {
      // Folding starts AT ONCE, into the place the card was opened from (2026-10-19: it stood still ~0.35 s over an
      // empty page while the level above was drawn and its card measured); the measuring below still runs and, if
      // the card stands elsewhere, the landing place is corrected on the way.
      setShrinking({ tag, path, mine: directItemsOf(path), subs: subFoldersOf(path), to: openedFrom.current.get(path) ?? null });
    }
    upPlain();
  };
  const goBack = () => {
    if (searchOpen) closeSearch();
    else if (inBin) leaveBin();
    else if (inCleanup) leaveCleanup();
    else if (selecting) leaveSelect();
    else if (path) up();
    else navigation.goBack();
  };
  const atRoot = !path && !selecting && !inBin && !inCleanup && !searchOpen;
  // A folder opens at its TOP. The list kept the offset it had a level up, so a folder opened from a scrolled
  // root stood scrolled too - the cover of «Модерний» a little high, then settling in small jerks as the list
  // clamped that offset to the new content (the user, 2026-10-12: «три невеликі ривки... підіймаючись трохи вище»).
  // The closing's landing place: the left folder's card, once the level above has been drawn.
  useEffect(() => {
    if (!shrinking || shrinking.checked) return;
    const leaving = shrinking.path;
    // THE CARD COMES BACK TO THE PLACE IT WAS OPENED FROM (the user, 2026-10-15: open, close, scroll a little, open the
    // same folder - it folded into where it had been the first time). The list offset is only known from scroll
    // events, and a tap right after a fling comes before the last of them: the level above came back to an old
    // offset, and the closing went there. So the offset is not trusted. The card's window rect AT THE TAP is exact
    // (measured then); after the level above is back, the card is measured and the list is moved by the difference
    // until the card stands exactly there. The cover still covers the whole screen while this happens.
    const saved = openedFrom.current.get(leaving) ?? null;
    let off = wantOffset.current;
    let tries = 0;
    let fixes = 0;
    const settleAt = Date.now() + (off > 0 ? 170 : 40);
    const land = (rect: Rect4) =>
      setShrinking((was) => {
        if (!was || was.path !== leaving) return was;
        const same = was.to && Math.abs(was.to.x - rect.x) < 2 && Math.abs(was.to.y - rect.y) < 2 && Math.abs(was.to.w - rect.w) < 2;
        return same ? { ...was, checked: true } : { ...was, to: rect, checked: true };
      });
    const scrollList = (o: number) =>
      (carrying.scrollRef.current as unknown as { scrollToOffset?: (p: { offset: number; animated: boolean }) => void } | null)?.scrollToOffset?.({ offset: o, animated: false });
    const again = () => {
      if (++tries < 10) setTimeout(look, 50);
      else if (saved) land(saved);
    };
    const look = () => {
      if (Date.now() < settleAt) {
        setTimeout(look, 25);
        return;
      }
      const node = cardNodes.current.get(leaving);
      if (!node) return again();
      node.measureInWindow((x, y, w, h) => {
        if (!(w > 0)) return again();
        const drift = saved ? y - saved.y : 0;
        if (saved && Math.abs(drift) > 2 && fixes < 3 && off + drift >= 0) {
          fixes++;
          off += drift;
          scrollList(off);
          setTimeout(look, 60);
          return;
        }
        // On the screen: fold into it. Off it (the list could not be moved that far): into the place it was opened from.
        if (y + h > 0 && y < winH) land({ x, y, w, h });
        else if (saved) land(saved);
        else again();
      });
    };
    const timer = setTimeout(look, 30);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, shrinking?.path]);
  // The opening fades once the folder's cover is fully drawn (FolderCover's onReady, below); this is only the
  // safety net, should the cover never say so.
  useEffect(() => {
    if (folderOpening.get()?.path !== path) return;
    const timer = setTimeout(() => {
      folderOpening.ready(path ?? '');
      setStage((was) => {
        if (was === 'cover') arrivalAt.current = Date.now();
        return 'all';
      });
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  // Each level REMEMBERS where it was scrolled to (2026-10-15, the user's: «папка зміщується вниз після закриття, а не на
  // тому місці, на якому я відкривав її»): a folder still opens at its top, but stepping back up returns the level
  // above to the offset it was left at - the card the folder folds back into then stands where it was opened from.
  const scrollMemory = useRef(new Map<string, number>());
  // Where each opened folder's card stood in the window, and the list offset at that moment - taken AT THE TAP.
  const openedFrom = useRef(new Map<string, Rect4>());
  const openedAtOffset = useRef<{ path: string; y: number } | null>(null);
  const lastPath = useRef(path);
  // The offset the list is being brought back to (0: none to wait for) - the closing measures its card after it.
  const wantOffset = useRef(0);
  useLayoutEffect(() => {
    const prev = lastPath.current;
    lastPath.current = path;
    const goingDeeper = path !== prev && (path.startsWith(`${prev}/`) || prev === '');
    if (path !== prev && goingDeeper) {
      const at = openedAtOffset.current;
      scrollMemory.current.set(prev, at && at.path === prev ? at.y : scrollY.value);
      openedAtOffset.current = null;
    }
    const target = path !== prev && !goingDeeper ? scrollMemory.current.get(path) ?? 0 : 0;
    wantOffset.current = target;
    const scrollTo = () =>
      (carrying.scrollRef.current as unknown as { scrollToOffset?: (o: { offset: number; animated: boolean }) => void } | null)?.scrollToOffset?.({ offset: target, animated: false });
    scrollTo();
    // The level above has just been drawn again: its list may not be tall enough yet for the offset to stick.
    const timers = target > 0 ? [setTimeout(scrollTo, 40), setTimeout(scrollTo, 120)] : [];
    setChromeCompact(false);
    return () => timers.forEach(clearTimeout);
  }, [path]);
  useTopBack(desk && atRoot ? null : goBack, isFocused && !inPane);
  // Inside a folder the three desks stay in the dock, the circle is back (deskBeadsBus's useDockDesksHere).
  useDockDesksHere(isFocused && !inPane);
  // The phone's own back (gesture or key): inside a folder it goes UP one level,
  // like the arrow in the bar; at the root it is left to leave the screen.
  useEffect(() => {
    if (!isFocused || (!path && !selecting && !inBin && !inCleanup && !searchOpen)) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (searchOpen) closeSearch();
      else if (inBin) leaveBin();
      else if (inCleanup) leaveCleanup();
      else if (selecting) leaveSelect();
      else up();
      return true;
    });
    return () => sub.remove();
  }, [isFocused, path, up, selecting, inBin, inCleanup, searchOpen]);
  useTopSearch(
    searchOpen
      ? { placeholder: 'Пошук у провіднику', initialQuery: searchText, onChangeQuery: setSearchText, onClose: closeSearch }
      : null,
    isFocused && !inPane
  );
  // The dock as every other window has it: the search field on the left with the dark «+» inside it
  // (the fan opens from there; held = the chat). In choosing / the bin / the cleanup view the dock
  // belongs to those, and the right bead is the way back, as before.
  const plain = !selecting && !inBin && !inCleanup;
  useDockBeads(
    isFocused && !inPane && plain
      ? {
          icon: searchOpen ? 'close-outline' : 'search-outline',
          active: searchOpen,
          onPress: () => (searchOpen ? closeSearch() : setSearchOpen(true)),
        }
      : null,
    isFocused && !inPane
      ? plain
        ? FEATURES.quickCreate
          ? { icon: 'add-outline', badge: 'add-circle-outline', onPress: () => setQuickOpen(true), onLongPress: () => openCapture() }
          : { icon: 'add-outline', badge: 'add-circle-outline', onPress: () => setFanOpen(true), onLongPress: () => openCapture(), onSlide: () => setFanOpen(true) }
        : { icon: 'chevron-back', onPress: goBack, keepIcon: true }
      : null
  );

  const crumbs: { label: string; onPress?: () => void; step?: string }[] = [{ label: 'Провідник', onPress: path ? () => setPath('') : undefined, step: '' }];
  path.split('/').filter(Boolean).forEach((seg, i, parts) => {
    const to = parts.slice(0, i + 1).join('/');
    crumbs.push({ label: seg, onPress: i < parts.length - 1 ? () => setPath(to) : undefined, step: to });
  });
  if (inBin) crumbs.push({ label: 'Кошик' });
  if (inBin) crumbs[0] = { label: 'Провідник', onPress: leaveBin };
  if (inCleanup) {
    crumbs.push({ label: 'Кандидати на очищення' });
    crumbs[0] = { label: 'Провідник', onPress: leaveCleanup };
  }
  const ownBar = !paneBar && !desk && topNavOn;
  const underBar = paneBar || ownBar || (!!desk && topNavOn);
  // The chip row stands still under the bar; the same gap above it as below it.
  const CHIPS_H = 36;
  const CHIPS_GAP = 14;
  const CHIPS_UP = 22;
  const chipsTop = insets.top + 12 + (underBar ? TOP_NAV_SPACE : 0) - CHIPS_UP;
  const top = insets.top + 12 + (underBar ? TOP_NAV_SPACE : 0);
  // As a desk the island's bar is the bar, so the folder's path is told to it the way the bases tell theirs
  // (useExplorer): the bar rolls from the desks to «Провідник › …» and a crumb leads back up.
  const publishToDock = useNavDockPublisher();
  useWhileFocused(() => {
    // The bin and the cleanup list say where they are too: with nothing published the bar kept the desk's own name
    // («Старт») over a list of dead things (the user, 2026-10-13).
    if (!desk || !publishToDock || (!path && !inBin && !inCleanup)) return;
    if (inBin) publishToDock({ kind: 'path', icon: 'trash-outline', crumbs: ['Кошик'], onGo: () => leaveBin() });
    else if (inCleanup) publishToDock({ kind: 'path', icon: 'folder-open-outline', crumbs: ['Кандидати на очищення'], onGo: () => leaveCleanup() });
    else publishToDock({ kind: 'path', icon: 'folder-open-outline', crumbs: path.split('/'), onGo: setPath });
    return () => publishToDock(null);
  }, [desk, publishToDock, path, inBin, inCleanup]);
  // As a desk, the sideways row of filter chips tells the drawers' swipe to start only from the screen's edge
  // there - the same as the start screen's «Нещодавні» row did - or scrolling the chips opened a drawer.
  const chipsShown = !inBin && !inCleanup && chipsOn && viewMode !== 'canvas';
  const { setEdgeZone } = useSideDrawerActions();
  useWhileFocused(() => {
    if (!desk || !chipsShown) return;
    setEdgeZone(chipsTop, chipsTop + CHIPS_H);
    return () => setEdgeZone(-1, -1);
  }, [desk, chipsShown, chipsTop, setEdgeZone]);

  const projectLabel = projOut
    ? `Крім «${groups.find((g) => g.id === projOut)?.name ?? 'проєкту'}»`
    : projFilter === '__none__'
      ? 'Без проєкту'
      : projFilter
        ? groups.find((g) => g.id === projFilter)?.name ?? 'Проєкт'
        : 'Проєкт';
  // Held: choose a project to take OUT of the list (held again while one is out: back in).
  async function excludeProject() {
    if (projOut) {
      setProjOut(null);
      return;
    }
    const live = groups.filter((g) => !g.archived).sort((a, b) => a.name.localeCompare(b.name));
    const choice = await ask({
      title: 'Прибрати проєкт зі списку',
      actions: live.map((g) => ({ id: g.id, label: g.name, icon: 'albums-outline' as const, tone: 'danger' as const })),
    });
    if (choice === 'cancel') return;
    setProjFilter(null);
    setProjOut(choice);
  }
  async function pickProject() {
    const live = groups.filter((g) => !g.archived).sort((a, b) => a.name.localeCompare(b.name));
    const choice = await ask({
      title: 'Проєкт',
      actions: [
        { id: 'all', label: 'Усі проєкти', icon: 'albums-outline' as const },
        { id: 'none', label: 'Без проєкту', icon: 'remove-circle-outline' as const },
        ...live.map((g) => ({ id: `g:${g.id}`, label: g.name, icon: 'albums-outline' as const })),
      ],
    });
    if (choice === 'cancel') return;
    setProjOut(null);
    setProjFilter(choice === 'all' ? null : choice === 'none' ? '__none__' : choice.slice(2));
  }
  const chip = (label: string, on: boolean, onPress: () => void, key: string, out = false, onHold?: () => void) => (
    <Pressable
      key={key}
      onPress={onPress}
      onLongPress={onHold}
      delayLongPress={350}
      style={[styles.chip, { backgroundColor: on ? S.ink : S.card, boxShadow: on ? undefined : S.popShadow }]}
    >
      <Text style={[styles.chipText, { color: on ? S.card : S.ink }, out && { textDecorationLine: 'line-through', color: '#B4533C' }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
  // «МОДЕРНИЙ» IS A LOOK, NOT ANOTHER EXPLORER (the user, 2026-10-12: «з точки зору функціоналу нічого не міняється...
  // всі ті самі кнопки, вся та сама логіка вкладення папок, просто інший зовнішній вигляд»): the same folders, the
  // same tap into a folder, the same hold menu, carrying and choosing - only each folder is drawn as the card the
  // «Проєкти» page drew (its size, colour, pattern or photo; FolderCard), and an opened folder wears its card as a
  // head (FolderHeader).
  const modernLook = (explorerStyle === 'modern' || explorerStyle === 'projects') && !inBin && !inCleanup && !searching;
  const listTopPad = top + (!inBin && !inCleanup && chipsOn ? CHIPS_H + CHIPS_GAP - CHIPS_UP : 0);
  const { height: winH } = useWindowDimensions();
  const schemeNow = useTheme().scheme;
  const cardTagOf = (p: string) =>
    p === UNFILED ? UNFILED_TAG : tags.filter((t) => t.path === p).find((t) => t.card) ?? tags.find((t) => t.path === p);
  const directItemsOf = (p: string) =>
    p === UNFILED ? items.filter((i) => (pathsOf.get(i.id) ?? []).length === 0) : items.filter((i) => (pathsOf.get(i.id) ?? []).includes(p));
  const subFolderNamesOf = (p: string) => [...new Set(tags.filter((t) => t.path.startsWith(`${p}/`)).map((t) => t.path.slice(p.length + 1).split('/')[0]))];
  const subFoldersOf = (p: string) => subFolderNamesOf(p).length;
  // THE INSPECTOR (frame B): view, order, switches, style; the chosen thing or folder, else the folder stood in; actions.
  const KIND_LABEL: Record<string, string> = { document: 'Нотатка', board: 'Дошка', file: 'Файл', photo: 'Фото', link: 'Посилання', flashcard: 'Картка', shortcut: 'Ярлик', collection: 'Підбірка', row: 'Запис' };
  const countWords = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'предмет' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'предмети' : 'предметів'}`;
  const pinsApi = usePins();
  const folderForPanel = (fp: string, isChosen: boolean) => {
    const colourable = fp !== UNFILED && !!fp;
    return {
      label: fp ? folderLabel(fp) : 'Провідник',
      sub: fp ? `${countWords(directItemsOf(fp).length)}${subFoldersOf(fp) ? ` · ${subFoldersOf(fp)} папок` : ''}` : `${countWords(items.length)} · ${new Set(tags.map((t) => t.path.split('/')[0])).size} папок`,
      chosen: isChosen,
      // The CARD's colour (tag.card.color - what the cover and the card draw), not the tag's own dot colour.
      colorId: colourable ? cardTagOf(fp)?.card?.color : undefined,
      onColor: colourable
        ? (id: string) => {
            const t = cardTagOf(fp);
            if (t) setTagFields(t.id, { card: { ...(t.card ?? { size: 'M' as const, pattern: 'light' as const }), color: id } }).catch(() => {});
          }
        : undefined,
      onOpen: isChosen ? () => chosenOpen.current?.() : undefined,
      pin: colourable ? { on: pinsApi.isPinned({ kind: 'folder', path: fp }), onToggle: () => pinsApi.toggle({ kind: 'folder', path: fp }) } : undefined,
    };
  };
  useEffect(() => setChosen(null), [path]);
  const chosenFolderPath = chosen?.startsWith('folder:') ? chosen.slice('folder:'.length) : null;
  const chosenItem = chosen && !chosenFolderPath ? items.find((i) => i.id === chosen) ?? null : null;
  usePublishRailPanel(
    explorerSelect ? (
      <ExplorerPanel
        view={viewMode === 'wide' ? 'grid' : viewMode}
        onView={(v) => changeView(v)}
        sortPref={sortPref}
        onSort={selectSortField}
        byKind={byKind}
        onByKind={toggleByKind}
        chipsOn={chipsOn}
        onChips={toggleChips}
        style={explorerStyle}
        onStyle={changeStyle}
        folder={chosenFolderPath !== null ? folderForPanel(chosenFolderPath, true) : folderForPanel(path, false)}
        chosen={
          chosenItem
            ? {
                title: chosenItem.title || 'Без назви',
                kind: KIND_LABEL[chosenItem.kind] ?? chosenItem.kind,
                facts: (() => {
                  const raw = (chosenItem.raw ?? {}) as Record<string, unknown>;
                  const out: { label: string; value: string }[] = [];
                  const where = (pathsOf.get(chosenItem.id) ?? []).map((p) => p.split('/').pop() ?? p);
                  out.push({ label: 'Папка', value: where.length ? where.join(', ') : 'Нерозкладене' });
                  const made = typeof raw.createdAt === 'number' ? raw.createdAt : undefined;
                  const changed = typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined;
                  if (made) out.push({ label: 'Створено', value: formatAddedOn(made, true) });
                  if (changed && changed !== made) out.push({ label: 'Змінено', value: formatAddedOn(changed, true) });
                  if (typeof raw.url === 'string') out.push({ label: 'Адреса', value: raw.url.replace(/^https?:\/\//, '').slice(0, 60) });
                  if (typeof raw.fileName === 'string') out.push({ label: 'Файл', value: raw.fileName });
                  if (typeof raw.size === 'number') out.push({ label: 'Розмір', value: raw.size > 1048576 ? `${(raw.size / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(raw.size / 1024))} КБ` });
                  return out;
                })(),
                onOpen: () => {
                  setChosen(null);
                  chosenOpen.current?.();
                },
              }
            : null
        }
        onNewFolder={() => setNaming('new')}
        onNewShortcut={() => newShortcut()}
        candidates={candidates.length}
        onCleanup={enterCleanup}
        binned={binned.length}
        onBin={enterBin}
      />
    ) : null
  );
  // The covers of the folders on this level, photographed ahead (PatternWarmup) - so a folder's first opening
  // grows one picture, not ~800 shapes.
  const warmJobs = modernLook
    ? folders
        .map((f) => {
          const tag = cardTagOf(f.path);
          return tag ? coverPatternJob(tag, directItemsOf(f.path), subFoldersOf(f.path), schemeNow, { w: winW, h: folderCoverHeight(winH, insets.top) }) : null;
        })
        .filter((j): j is NonNullable<typeof j> => !!j)
    : [];
  // (Declared before the «Модерний» layout below, which calls it - after it, the layout called undefined and the
  // explorer fell over, 2026-10-15.)
  // A COLLECTION OR A PLAYLIST shows what is in it (CollectionCard), never a folder icon.
  const collKindOf = (f: FolderEntry): CollectionCardKind | null =>
    !FEATURES.collectionCards ? null : f.playlist ? 'video' : f.collection === 'geo' ? 'geo' : f.collection === 'photo' ? 'photo' : null;
  const collItemsOf = (f: FolderEntry, kind: CollectionCardKind) =>
    directItemsOf(f.path).filter((i) =>
      kind === 'photo' ? i.kind === 'photo' : i.kind === 'link' && i.linkCategory === (kind === 'geo' ? 'geo' : 'video')
    );
  // The size counts in the grid too (L a whole line, S a capsule), not only in «Модерний» - see collectionFaceFor.
  const collLookOf = (f: FolderEntry) => collectionFaceFor(cardTagOf(f.path)?.card, viewMode === 'grid' ? 'grid' : 'list');
  const collFaceOf = (f: FolderEntry): CollectionFaceStyle => collLookOf(f).face;
  // «МОДЕРНИЙ» LAID OUT WITHOUT HOLES (the user, 2026-10-12: «таких дірок не повинно бути, система сама повинна
  // рухатися в сторону заповнення дірок... більш-менш зберігаючи сортування»). Two columns, every card but the
  // large ones going into the SHORTER one, in the sort order - so two small cards stack beside a middle one. A large
  // card takes the whole width and closes the columns; before it, if one column is short by about a card, the
  // nearest fitting card from just after (at most three places on) is pulled up to fill it.
  type ModernBlock = { kind: 'wide'; f: FolderEntry } | { kind: 'cols'; cols: FolderEntry[][] };
  const modernBlocks: ModernBlock[] = [];
  // A folder is M or S (only «Думки» is big); a collection keeps its three faces.
  const sizeOf = (f: FolderEntry) =>
    f.path === BIN_PATH ? 'M' : collKindOf(f) ? cardTagOf(f.path)?.card?.size ?? 'M' : folderCardSize(cardTagOf(f.path)?.card);
  if (modernLook) {
    // A small FOLDER is half a middle one less the gap (two stand beside one); a small COLLECTION stays a capsule.
    const CARD_H = { S: 95, M: 200 } as Record<string, number>;
    const GAP = 10;
    const CARD_MIN_W = 200;
    const queue: FolderEntry[] = [...folders];
    // The bin stays on the first level even when empty - an empty basket (BinCard).
    const binEntry = !path && !filtering && (!projectsHere || focusProj === NO_PROJECT) ? ({ path: BIN_PATH, name: 'Кошик', count: binned.length } as FolderEntry) : null;
    // AS MANY COLUMNS AS FIT (2026-10-16, the Mac): the phone's two, and on a wide screen as many cards of about a
    // phone card's width (~220) as the width holds - two there stretched every card to half the screen.
    // AS MANY COLUMNS AS CARDS OF 200..260 FIT: a rule, not a share of the window (2026-10-19) - a wider window gets
    // MORE cards, never wider ones. The phone keeps its two.
    const nCols = touchDensity ? 2 : Math.max(2, Math.floor((contentW + GAP) / (CARD_MIN_W + GAP)));
    let cols: FolderEntry[][] = Array.from({ length: nCols }, () => []);
    let hs: number[] = Array(nCols).fill(0);
    const place = (f: FolderEntry) => {
      // A middle collection card (photo, points, video) is a folder's size now.
      const h = (collKindOf(f) ? (sizeOf(f) === 'M' ? 200 : sizeOf(f) === 'S' ? 58 : 140) : CARD_H[sizeOf(f)]) ?? 140;
      let k = 0;
      for (let i = 1; i < nCols; i += 1) if (hs[i] < hs[k]) k = i;
      cols[k].push(f);
      hs[k] += h + GAP;
    };
    const close = () => {
      if (cols.some((c) => c.length)) modernBlocks.push({ kind: 'cols', cols });
      cols = Array.from({ length: nCols }, () => []);
      hs = Array(nCols).fill(0);
    };
    // Before a large card (or the end): fill a short column from the next few cards.
    const balance = () => {
      for (let guard = 0; guard < 4; guard += 1) {
        const gap = Math.max(...hs) - Math.min(...hs);
        if (gap < 40) return;
        const want = gap >= 140 ? 'M' : 'S';
        let pick = queue.slice(0, 3).findIndex((g) => sizeOf(g) === want);
        if (pick < 0) pick = queue.slice(0, 3).findIndex((g) => sizeOf(g) !== 'L');
        if (pick < 0) return;
        place(queue.splice(pick, 1)[0]);
      }
    };
    while (queue.length) {
      const f = queue.shift()!;
      if (sizeOf(f) === 'L') {
        queue.unshift(f);
        balance();
        queue.splice(queue.indexOf(f), 1);
        close();
        modernBlocks.push({ kind: 'wide', f });
      } else place(f);
    }
    balance();
    // THE BIN, LAST: a middle card now (the wire basket), into the shorter column.
    if (binEntry) place(binEntry);
    close();
  }
  const openFolderEntry = (f: FolderEntry) => {
    closeSearch();
    if (f.playlist) setPlaylistPath(f.path);
    else if (f.collection) setCollectionOpen({ path: f.path, kind: f.collection });
    else setPath(f.path);
  };
  // A list row, arriving after the folder cards when the folder was stepped into through its opening.
  // The rows come in from the corner as a folder opens. ALWAYS the same wrapper, only its `entering` differs: wrapped
  // while arriving and bare afterwards, the first render after the arrival (a pick, anything) changed every row's tree
  // and React made every row anew - a swipe that was picking lost its gesture with its row (2026-10-19).
  const withArrival = (rowIndex: number, el: React.ReactElement) => {
    const coming = arriving() && !!path;
    const cardsBefore =
      coming && modernLook && stage === 'all'
        ? modernBlocks.reduce((n, b) => n + (b.kind === 'wide' ? 1 : b.cols.reduce((m, c) => m + c.length, 0)), 0)
        : 0;
    return <Animated.View entering={coming ? cornerIn(Math.min(cardsBefore + rowIndex, 12) * 32) : undefined}>{el}</Animated.View>;
  };
  const header = (
    <View>
      {/* THE LIVING FOLDER of thoughts, first on the explorer's first level (components/thoughts). */}
      {projectsHere && (
        <View style={{ marginTop: -listTopPad, marginBottom: 14 }}>
        <ProjectsBand
          height={folderCoverHeight(winH, insets.top)}
          topPad={listTopPad}
          groups={groups.filter((g) => !g.archived).sort((a, b) => a.name.localeCompare(b.name))}
          focusId={focusProj}
          onFocus={changeFocusProj}
          counts={bandCounts}
          noneCount={bandNoneCount}
          rootFor={(id) => {
            const r = [...(rootPathsOf.get(id) ?? [])];
            return r.length ? r.map((x) => nameOf(x)).join(', ') : null;
          }}
          onRootPress={async (id) => {
            const r = [...(rootPathsOf.get(id) ?? [])][0];
            if (!r) return;
            try {
              setProjectsFor(await tagForPath(r));
            } catch (e) {
              notify('Не вдалося відкрити', (e as Error).message);
            }
          }}
        />
        </View>
      )}
      {FEATURES.thoughts && !path && !inBin && !inCleanup && !searching && !filtering && (!projectsHere || focusProj === NO_PROJECT) && <ThoughtsFolder />}
      {modernLook && !!path && cardTagOf(path) && (
        // Edge to edge and up under the bar: out of the list's own side and top padding.
        <View style={{ marginHorizontal: -20, marginTop: -listTopPad, marginBottom: 18 }}>
          <FolderCover
            tag={cardTagOf(path)!}
            mine={directItemsOf(path)}
            subs={subFoldersOf(path)}
            height={folderCoverHeight(winH, insets.top)}
            topInset={insets.top}
            onReady={() => {
              if (path && folderOpening.get()?.path === path) {
                folderOpening.ready(path);
                // The things come in as the opening fades.
                showContent();
              }
            }}
          />
        </View>
      )}
      {modernLook && stage === 'all' && (
        <View style={styles.modernLines}>
          {(() => {
            let order = 0;
            const card = (f: FolderEntry) => {
              const n = order++;
              if (f.path === BIN_PATH) {
                return <BinCard key={BIN_PATH} count={binned.length} kinds={binned.slice(0, 15).map((i) => i.kind)} onPress={enterBin} />;
              }
              const tag = cardTagOf(f.path);
              if (!tag) return null;
              const collKind = collKindOf(f);
              const size = collKind ? tag.card?.size ?? 'M' : folderCardSize(tag.card);
              if (collKind) {
                return (
                  <Animated.View
                    key={f.path}
                    collapsable={false}
                    entering={arriving() && !!path ? cornerIn(Math.min(n, 10) * 32) : undefined}
                    style={size === 'S' ? { height: 58 } : undefined}
                    ref={(node: View | null) => {
                      carrying.carry.registerFolder(f.path)(node as never);
                      if (f.path !== UNFILED) carrying.carry.registerCard(`folder:${f.path}`, () => carrying.groupFor(folderItem(f)), () => holdFolder(f))(node as never);
                    }}
                  >
                    <TurningPressable
                      cardKey={`collection:${f.path}`}
                      onPress={(e) => (size === 'M' && collKind !== 'video' && !!f.collection ? blowOpen(f, collKind, e) : openFolderEntry(f))}
                      onLongPress={() => holdFolder(f)}
                      delayLongPress={350}
                      style={size === 'S' ? { flex: 1 } : undefined}
                    >
                      <CollectionCard kind={collKind} name={f.name} count={f.count} items={collItemsOf(f, collKind)} face={size} blowing={blowing === f.path} />
                    </TurningPressable>
                  </Animated.View>
                );
              }
              return (
                <Animated.View
                  key={f.path}
                  collapsable={false}
                  entering={arriving() && !!path ? cornerIn(Math.min(n, 10) * 32) : undefined}
                  // A small card keeps its own height (it stretched to a taller neighbour's).
                  {...webData({ card: `folder:${f.path}` })}
                  style={[size === 'S' ? { height: 95 } : undefined, chosen === `folder:${f.path}` && { boxShadow: `0 0 0 2px ${S.ink}`, borderRadius: 20 }]}
                  ref={(node: View | null) => {
                    if (node) cardNodes.current.set(f.path, node);
                    else cardNodes.current.delete(f.path);
                    carrying.carry.registerFolder(f.path)(node as never);
                    if (f.path !== UNFILED) carrying.carry.registerCard(`folder:${f.path}`, () => carrying.groupFor(folderItem(f)), () => holdFolder(f))(node as never);
                  }}
                >
                  {projectsHere && focusProj === NO_PROJECT && f.path !== UNFILED && (
                    <Pressable
                      onPress={async () => {
                        try {
                          setProjectsFor(await tagForPath(f.path));
                        } catch (e) {
                          notify('Не вдалося відкрити', (e as Error).message);
                        }
                      }}
                      hitSlop={6}
                      accessibilityLabel="Додати до проєкту"
                      style={{ position: 'absolute', top: 10, left: 10, zIndex: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 11, backgroundColor: S.card, opacity: 0.92 }}
                    >
                      <Text style={{ fontSize: 11, color: S.ink2, fontFamily: SOFT_MEDIUM }}>у проєкт…</Text>
                    </Pressable>
                  )}
                  <FolderCard
                    tag={tag}
                    half={size !== 'L'}
                    mine={directItemsOf(f.path)}
                    subs={subFoldersOf(f.path)}
                    subNames={subFolderNamesOf(f.path)}
                    navigation={navigation}
                    onOpen={(t, event) => {
                      if (explorerSelect && !pickTwice(`folder:${f.path}`, () => openFolderEntry(f))) return;
                      const target = (event as unknown as { flipTarget?: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void } } | undefined)?.flipTarget;
                      // The opening FIRST; the folder is stepped into right after it starts (onGrown).
                      if (target && !f.playlist && !f.collection) {
                        // The offset is read now, at the tap, not later from a list that has begun to change.
                        openedAtOffset.current = { path, y: scrollY.value };
                        target.measureInWindow((x, y, w, h) => {
                          openedFrom.current.set(f.path, { x, y, w, h });
                          // Into the store, not the explorer's state: the explorer does not re-render for it.
                          folderOpening.start({
                            tag: t,
                            from: { x, y, w, h },
                            path: f.path,
                            entry: f,
                            mine: directItemsOf(f.path),
                            subs: subFoldersOf(f.path),
                            subNames: subFolderNamesOf(f.path),
                            ground: S.bg,
                            onGrown: () => {
                              if (FEATURES.openOneStep) arrivalAt.current = Date.now();
                              else setStage('cover');
                              openFolderEntry(f);
                            },
                          });
                        });
                      } else openFolderEntry(f);
                    }}
                    onHold={() => holdFolder(f)}
                  />
                </Animated.View>
              );
            };
            return modernBlocks.map((b, i) =>
              b.kind === 'wide' ? (
                <View key={`w${b.f.path}`}>{card(b.f)}</View>
              ) : (
                <View key={`c${i}`} style={styles.modernLine}>
                  {b.cols.map((c, k) => (
                    <View key={k} style={[styles.modernCol, !touchDensity && styles.modernColCapped]}>
                      {c.map(card)}
                    </View>
                  ))}
                </View>
              )
            );
          })()}
        </View>
      )}
      <View style={styles.folders}>
        {(modernLook ? [] : folders).filter((f) => !collKindOf(f)).map((f) => {
          return (
          <Pressable
            key={f.path}
            ref={(node) => {
              carrying.carry.registerFolder(f.path)(node as never);
              if (f.path !== UNFILED) carrying.carry.registerCard(`folder:${f.path}`, () => carrying.groupFor(folderItem(f)), () => holdFolder(f))(node as never);
            }}
            collapsable={false}
            onPress={() => {
              closeSearch();
              if (f.playlist) setPlaylistPath(f.path);
              else if (f.collection) setCollectionOpen({ path: f.path, kind: f.collection });
              else setPath(f.path);
            }}
            style={[styles.folder, { backgroundColor: S.card, boxShadow: S.popShadow }, f.playlist && styles.playlistCard]}
          >
            {f.playlist ? (
              <PlaylistFace
                videos={items
                  .filter((i) => i.kind === 'link' && i.linkCategory === 'video' && (pathsOf.get(i.id) ?? []).includes(f.path))
                  .slice(0, 3)
                  .map(videoOf)}
                name={f.name}
                count={f.count}
              />
            ) : (
            <>
            <View style={[styles.seat, { backgroundColor: S.bg }]}>
              <Ionicons name={(f.icon as never) || ("folder-outline" as never)} size={22} color={f.color ?? S.ink2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.folderName, { color: S.ink }]} numberOfLines={1}>
                {f.name}
              </Text>
              <Text style={[styles.folderCount, { color: S.ink3 }]}>{f.count}</Text>
            </View>
            </>
            )}
          </Pressable>
          );
        })}
        {!modernLook && !path && !inBin && !inCleanup && !filtering && !searching && binned.length > 0 && (
          <Pressable onPress={enterBin} style={[styles.folder, { backgroundColor: S.card, boxShadow: S.popShadow }]}>
            <View style={[styles.seat, { backgroundColor: S.bg }]}>
              <Ionicons name="trash-outline" size={22} color={S.ink2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.folderName, { color: S.ink }]} numberOfLines={1}>Кошик</Text>
              <Text style={[styles.folderCount, { color: S.ink3 }]}>{binned.length}</Text>
            </View>
          </Pressable>
        )}
      </View>
      {/* THE COLLECTIONS, under the folders and on their own lines: a tall face beside a folder stretched the folder
          to its height, empty (2026-10-15). */}
      {!modernLook && folders.some((f) => !!collKindOf(f)) && (
        <View style={[styles.folders, viewMode === 'grid' && { alignItems: 'flex-start' }]}>
          {folders.filter((f) => !!collKindOf(f)).map((f) => {
            const collKind = collKindOf(f)!;
            return (
              <Pressable
                key={f.path}
                ref={(node) => {
                  carrying.carry.registerFolder(f.path)(node as never);
                  if (f.path !== UNFILED) carrying.carry.registerCard(`folder:${f.path}`, () => carrying.groupFor(folderItem(f)), () => holdFolder(f))(node as never);
                }}
                collapsable={false}
                // The hold is the carrying's (registerCard), as on the folders.
                onPress={() => openFolderEntry(f)}
                // The list: a whole line. The grid: two to a line - a large one the whole line.
                // In points, not a stretching 48%: a tile alone on its line grew to the whole width.
                style={collLookOf(f).wide ? styles.collRow : { width: Math.floor((contentW - FOLDER_GAP) / 2) }}
              >
                <CollectionCard kind={collKind} name={f.name} count={f.count} items={collItemsOf(f, collKind)} face={collFaceOf(f)} />
              </Pressable>
            );
          })}
        </View>
      )}
      {!path && !inBin && !inCleanup && here.length > 0 && <Text style={[styles.sectionLabel, { color: S.ink3 }]}>{`Без папки · ${here.length}`}</Text>}
      {inCleanup && <Text style={[styles.sectionLabel, { color: S.ink3 }]}>{`Кандидати на очищення · ${here.length}`}</Text>}
    </View>
  );

  return (
    <View style={styles.container}>
      <ScreenGround color={S.bg} />
      {isFocused && ownBar && <TopNavBar trail={{ icon: 'folder-open-outline', crumbs }} />}
      <FolderGrowLayer />
      {shrinking && (
        <GlassPortal priority={-1} name="folderShrink">
          <FolderShrink
            tag={shrinking.tag}
            to={shrinking.to}
            ground={S.bg}
            mine={shrinking.mine}
            subs={shrinking.subs}
            subNames={subFolderNamesOf(shrinking.path)}
            onDone={() => setShrinking(null)}
          />
        </GlassPortal>
      )}
      {warmJobs.length > 0 && <FolderWarmup jobs={warmJobs} cover={stage === 'cover'} />}
      <SoftSurfaceContext.Provider value={S}>
      {!inBin && !inCleanup && chipsOn && viewMode !== 'canvas' && (
        <View style={[styles.chipsBar, { top: chipsTop, backgroundColor: S.bg }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {chip('Усі', kindFilter.size === 0 && kindOut.size === 0, () => { setKindFilter(new Set()); setKindOut(new Set()); }, 'all')}
          {KIND_ORDER.filter((k) => (kindCounts.get(k) ?? 0) > 0).map((k) =>
            chip(
              `${KIND_TITLE[k]} · ${kindCounts.get(k)}`,
              kindFilter.has(k),
              // Several kinds can be on at once: images AND video, say.
              () =>
                {
                  setKindOut((prev) => {
                    const next = new Set(prev);
                    next.delete(k);
                    return next;
                  });
                  setKindFilter((prev) => {
                    const next = new Set(prev);
                    if (next.has(k)) next.delete(k);
                    else next.add(k);
                    return next;
                  });
                },
              k,
              kindOut.has(k),
              // Held: this kind goes OUT of the list (held again: back in).
              () => {
                hapticSelectItem();
                setKindFilter((prev) => {
                  const next = new Set(prev);
                  next.delete(k);
                  return next;
                });
                setKindOut((prev) => {
                  const next = new Set(prev);
                  if (next.has(k)) next.delete(k);
                  else next.add(k);
                  return next;
                });
              }
            )
          )}
          {chip(projectLabel, projFilter !== null || projOut !== null, pickProject, 'proj', projOut !== null, excludeProject)}
        </ScrollView>
        </View>
      )}

        {viewMode === 'canvas' && !inBin && !inCleanup ? (
          // «Полотно»: the folders as islands with their things on them, carried by hand (FoldersCanvas,
          // the one the «Папки» screen has). Only what lies in some folder stands on it.
          <FoldersCanvas topPad={top} linksOpen={false} onOpenItem={(item) => openItem(item)} />
        ) : (
        <GestureDetector gesture={carrying.listGesture}>
        <View style={{ flex: 1 }} {...webData({ explorer: '1' })} onLayout={touchDensity ? undefined : (e) => setMeasuredW(Math.round(e.nativeEvent.layout.width))}>
        <SwipeSelectArea
          enabled={FEATURES.swipeSelect && viewMode === 'list'}
          order={sweepOrder}
          isSelectMode={selecting}
          selectedIds={selected}
          onSelect={(ids) => {
            setSelected(ids);
            if (ids.size > 0) setSelecting(true);
          }}
          onEnd={(ids) => {
            if (ids.size === 0 && !inBin && !inCleanup) leaveSelect();
          }}
          onToggle={toggle}
          scroll={carrying}
        >
        <FlatList
          ref={carrying.scrollRef as never}
          data={stage === 'cover' ? [] : rows}
          extraData={stage}
          keyExtractor={(row) => (isHeader(row) || isCells(row) || isStrip(row) ? row.key : row.id)}
          ListHeaderComponent={header}
          ListEmptyComponent={
            stage === 'all' && folders.length === 0 ? <Text style={[styles.hint, { color: S.ink3 }]}>{searching ? 'Нічого не знайдено.' : path ? 'У цій папці ще порожньо.' : projectsHere && focusProj !== NO_PROJECT ? 'У цьому проєкті ще немає папок. Додати: «Без проєкту» → «у проєкт…».' : 'Ще нічого немає.'}</Text> : null
          }
          renderItem={({ item: row, index: rowIndex }) => withArrival(rowIndex, (() => {
            if (isHeader(row)) {
              return <Text style={[styles.sectionLabel, { color: S.ink3, marginTop: 6 }]}>{`${row.header} · ${row.count}`}</Text>;
            }
            // The bases' OWN cards handle their own selection (a tick on the cell); only ours
            // (the list's rows, boards, cards, shortcuts) get the explorer's frame and tick.
            const native = (item: FolderItem) =>
              (viewMode === 'grid' && ['photo', 'file', 'link', 'document'].includes(item.kind)) || (viewMode === 'wide' && item.kind === 'document');
            const cell = (item: FolderItem, tile: boolean, strip?: number) => {
              const own = native(item) || strip !== undefined;
              const card = (
                <FolderItemCard
                  key={own && tile ? item.id : undefined}
                  item={item}
                  tags={tags}
                  mode={tile ? 'grid' : 'list'}
                  tileWidth={strip ?? (tile ? tileW : contentW)}
                  columns={strip !== undefined ? 1 : gridCols}
                  onPress={(e) => {
                    if (selecting) return toggle(item.id);
                    if (explorerSelect && !pickTwice(item.id, () => openItem(item))) return;
                    openItem(item, e);
                  }}
                  // The tick is ours for EVERY card (the bases' cells drew pink, black, whatever their
                  // own colour was - the user saw mixed ticks, 2026-10-12): none passed down.
                />
              );
              // A native grid cell is a flex item that fills its row: a row the width of the
              // column makes it fill the column.
              if (own && tile) {
                return (
                  <View key={item.id} ref={(n) => carrying.carry.registerCard(item.id, () => carrying.groupFor(item), () => holdItem(item))(n as never)} collapsable={false} {...webData({ card: item.id })} style={[{ width: strip ?? tileW }, chosen === item.id && { boxShadow: `0 0 0 2px ${S.ink}`, borderRadius: 18 }]}>
                    <SwipeSelectItem id={item.id}>
                    <View style={styles.nativeCell} pointerEvents={selecting ? 'none' : 'auto'}>
                      {card}
                    </View>
                    {selecting && (
                      <Pressable style={StyleSheet.absoluteFill} onPress={() => toggle(item.id)}>
                        {selected.has(item.id) && <View pointerEvents="none" style={[styles.pickedFrame, { borderColor: S.ink, borderRadius: 18 }]} />}
                        <View style={[styles.check, { borderColor: S.ink3, backgroundColor: selected.has(item.id) ? S.ink : S.card }]}>
                          {selected.has(item.id) && <Ionicons name="checkmark" size={16} color={S.card} />}
                        </View>
                      </Pressable>
                    )}
                    </SwipeSelectItem>
                  </View>
                );
              }
              return (
                <View key={item.id} ref={(n) => carrying.carry.registerCard(item.id, () => carrying.groupFor(item), () => holdItem(item))(n as never)} collapsable={false} {...webData({ card: item.id })} style={[tile ? { width: tileW } : styles.cardWrap, chosen === item.id && { boxShadow: `0 0 0 2px ${S.ink}`, borderRadius: tile ? 18 : 14 }]}>
                  <SwipeSelectItem id={item.id}>
                  <View pointerEvents={selecting ? 'none' : 'auto'}>{card}</View>
                  {selecting && (
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => toggle(item.id)}>
                      {selected.has(item.id) && !tile && <View pointerEvents="none" style={[styles.pickedFrame, { borderColor: S.ink }]} />}
                      {selected.has(item.id) && tile && <View pointerEvents="none" style={[styles.pickedFrame, { borderColor: S.ink, borderRadius: 18 }]} />}
                      <View style={[styles.check, { borderColor: S.ink3, backgroundColor: selected.has(item.id) ? S.ink : S.card }]}>
                        {selected.has(item.id) && <Ionicons name="checkmark" size={16} color={S.card} />}
                      </View>
                    </Pressable>
                  )}
                  </SwipeSelectItem>
                </View>
              );
            };
            if (isStrip(row)) {
              const gap = 8;
              const w = Math.floor((contentW - gap * 2) / 3);
              return (
                <View style={{ flexDirection: 'row', gap, marginBottom: gap }}>
                  {row.strip.map((p) => cell(p, true, w))}
                </View>
              );
            }
            if (isCells(row)) {
              return (
                <CascadeGrid
                  items={row.cascade}
                  columns={gridCols}
                  colWidth={tileW}
                  gap={TILE_GAP}
                  estimate={(i) => estimateHeight(i, tileW)}
                  renderCell={(c) => cell(c, true)}
                />
              );
            }
            return cell(row, false);
          })())}
          contentContainerStyle={{ paddingTop: listTopPad, paddingBottom: dockClear + insets.bottom + 24 + (!touchDensity && FEATURES.macFrameB ? COMPOSER_CLEAR : 0), paddingHorizontal: 20 }}
          onScroll={(e) => {
            scrollY.value = e.nativeEvent.contentOffset.y;
            notifyCascadeScroll();
            if (FEATURES.chromeCompact) chromeScroll(e);
          }}
          scrollEventThrottle={120}
          // The throttled onScroll misses the last offset of a drag or a fling; these two give it, so a folder
          // opened right after scrolling remembers the place it was really opened from.
          onScrollBeginDrag={() => listMoved()}
          onScrollEndDrag={(e) => (scrollY.value = e.nativeEvent.contentOffset.y)}
          onMomentumScrollEnd={(e) => (scrollY.value = e.nativeEvent.contentOffset.y)}
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews
        />
        </SwipeSelectArea>
        </View>
        </GestureDetector>
        )}
      </SoftSurfaceContext.Provider>
      {/* What runs off the top and the bottom melts into the ground under the bar and the dock, as in the notes and
          the boards (EdgeFade) - missed in the explorer (the user, 2026-10-13). Not over a folder's cover (its picture
          runs under the bar on purpose), and not with a pointer (the desktop keeps its hard edges). */}
      {touchDensity && !(modernLook && !!path && !!cardTagOf(path)) && (
        <>
          <EdgeFade edge="top" color={S.bg} height={top} />
          <EdgeFade edge="bottom" color={S.bg} height={Math.round((dockClear + insets.bottom) * 0.85)} />
        </>
      )}
      <Modal visible={viewerItem !== null} transparent animationType="fade" onRequestClose={() => setViewerId(null)}>
        {viewerItem && (
          <GestureHandlerRootView style={{ flex: 1 }}>
            <ZoomableImageViewer
              uri={viewerRaw.imageUri as string}
              driveFileId={typeof viewerRaw.driveFileId === 'string' ? viewerRaw.driveFileId : undefined}
              onClose={() => setViewerId(null)}
              actions={viewerActions(viewerItem)}
              onPrev={viewerIndex > 0 ? () => setViewerId(photosHere[viewerIndex - 1].id) : undefined}
              onNext={viewerIndex < photosHere.length - 1 ? () => setViewerId(photosHere[viewerIndex + 1].id) : undefined}
              sketchElements={viewerRaw.sketchElements as never}
              sketchWidth={viewerRaw.sketchWidth as number | undefined}
              sketchHeight={viewerRaw.sketchHeight as number | undefined}
            />
          </GestureHandlerRootView>
        )}
      </Modal>
      <VideoPlayerModal url={videoUrl} onClose={() => setVideoUrl(null)} />
      <FilePreviewWorker />
      <DocumentQuickLook
        file={quickLook}
        onClose={() => setQuickLook(null)}
        onOpenElsewhere={() => {
          const raw = ((quickLook?.item.raw ?? {}) as Record<string, unknown>);
          const q = quickLook;
          setQuickLook(null);
          if (q) openFileExternally({ id: q.item.docId, fileUri: raw.fileUri as string, fileName: (raw.fileName as string) ?? q.item.title, mimeType: raw.mimeType as string | undefined, driveFileId: raw.driveFileId as string | undefined });
        }}
      />
      <LinkCardHost flipFrom={linkFlip} item={linkItem} tags={tags} onClose={() => setLinkId(null)} onPlayVideo={setVideoUrl} onPickFolders={(i) => setFoldersFor([i])} />
      <FlashcardReader
        flipFrom={cardFlip}
        cards={cardIndex >= 0 ? cardsHere : null}
        startIndex={Math.max(0, cardIndex)}
        isLearning={(card) => !!groups.find((g) => g.id === card.groupId)?.flashcardLearning}
        onSetKnown={(card, known) => updateDoc(doc(db, 'flashcards', card.id), { known, updatedAt: Date.now() }).catch(() => {})}
        onEdit={(card) => {
          setCardId(null);
          setEditingCard(card);
        }}
        onOpenImage={(card, index) => setCardImage({ card, index })}
        onClose={() => setCardId(null)}
      />
      <FlashcardEditor visible={editingCard !== null} card={editingCard} groups={groups} tagApi={tagApi} onClose={() => setEditingCard(null)} />
      {cardImage && cardImage.card.images[cardImage.index] && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setCardImage(null)}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <ZoomableImageViewer
              uri={cardImage.card.images[cardImage.index].uri}
              driveFileId={cardImage.card.images[cardImage.index].driveFileId}
              onClose={() => setCardImage(null)}
              onPrev={cardImage.index > 0 ? () => setCardImage({ ...cardImage, index: cardImage.index - 1 }) : undefined}
              onNext={cardImage.index < cardImage.card.images.length - 1 ? () => setCardImage({ ...cardImage, index: cardImage.index + 1 }) : undefined}
            />
          </GestureHandlerRootView>
        </Modal>
      )}
      <RenamePrompt
        visible={naming !== null}
        title="Нова папка"
        initialValue=""
        onCancel={() => setNaming(null)}
        onSave={(name) => {
          const purpose = naming;
          setNaming(null);
          makeFolder(name, purpose === 'move');
        }}
      />
      <SketchEditor
        visible={sketching !== null}
        initialElements={((sketching?.raw ?? {}) as Record<string, unknown>).sketchElements as SketchElement[] ?? []}
        background={sketching ? { uri: ((sketching.raw ?? {}) as Record<string, unknown>).imageUri as string } : undefined}
        onSave={(elements, width, height) => {
          const item = sketching;
          setSketching(null);
          if (item) {
            const used = Object.keys((((item.raw ?? {}) as Record<string, unknown>).usedInDocuments as Record<string, boolean>) ?? {});
            savePhotoSketch(item.docId, used, elements, width, height).catch((e) => notify('Не вдалося зберегти малюнок', (e as Error).message));
          }
        }}
        onClose={() => setSketching(null)}
      />
      <TagEditSheet
        visible={lookTag !== null}
        tag={lookTag}
        onCancel={() => setLookTag(null)}
        onSave={async (newPath, icon, color, types) => {
          const target = lookTag;
          setLookTag(null);
          if (!target) return;
          try {
            await updateTag(target, { path: target.path, icon, color, types: types as never });
            await setFolderAppearance(target.path, { icon, color });
            const renamed = newPath.trim();
            if (renamed && renamed !== target.path) await moveBranch(target.path, renamed);
          } catch (e) {
            notify('Не вдалося зберегти', (e as Error).message);
          }
        }}
      />
      <FolderProjectsSheet
        visible={projectsFor !== null}
        folderName={projectsFor ? nameOf(projectsFor.path) : ''}
        selected={projectsFor?.groupIds ?? []}
        selectedRoots={projectsFor?.projectRoots ?? []}
        onClose={() => setProjectsFor(null)}
        onSave={async (ids, roots) => {
          const target = projectsFor;
          setProjectsFor(null);
          if (!target) return;
          try {
            await setTagFields(target.id, { groupIds: ids, projectRoots: roots });
          } catch (e) {
            notify('Не вдалося зберегти', (e as Error).message);
          }
        }}
      />
      <FolderCardSheet
        visible={cardTag !== null}
        folderName={cardTag ? nameOf(cardTag.path) : ''}
        card={cardTag?.card}
        collection={!!cardTag && FEATURES.collectionCards && folders.some((f) => f.path === cardTag.path && (f.playlist || !!f.collection))}
        onClose={() => setCardTag(null)}
        onSave={async (card) => {
          const target = cardTag;
          setCardTag(null);
          if (!target) return;
          try {
            // Every tag of the folder's path carries the same look; a photo background stays where it is.
            for (const t of tags.filter((x) => x.path === target.path)) {
              await setTagFields(t.id, { card: card ? { ...card, ...(t.card?.bg ? { bg: t.card.bg } : {}) } : (deleteField() as never) });
            }
          } catch (e) {
            notify('Не вдалося зберегти', (e as Error).message);
          }
        }}
      />
      {FEATURES.collections && (
        <CollectionWindow
          visible={collectionOpen !== null}
          kind={collectionOpen?.kind ?? 'photo'}
          title={collectionOpen ? nameOf(collectionOpen.path) : ''}
          items={collectionItems}
          flipFrom={collectionFlip}
          onClose={() => setCollectionOpen(null)}
        />
      )}
      <PlaylistWindow
        visible={playlistPath !== null}
        title={playlistPath ? nameOf(playlistPath) : ''}
        videos={playlistVideos}
        onClose={() => setPlaylistPath(null)}
      />
      <ItemFoldersSheet
        visible={foldersFor !== null}
        paths={folderPaths}
        initial={foldersFor ? sharedPaths(foldersFor) : []}
        count={foldersFor?.length ?? 0}
        onSave={saveFolders}
        onClose={() => setFoldersFor(null)}
      />
      <RenamePrompt
        visible={renamingFolder !== null}
        title="Нова назва папки"
        initialValue={renamingFolder?.name ?? ''}
        onCancel={() => setRenamingFolder(null)}
        onSave={renameFolderTo}
      />
      <RenamePrompt
        visible={renaming !== null}
        title="Нова назва"
        initialValue={renaming?.title ?? ''}
        onCancel={() => setRenaming(null)}
        onSave={renameOne}
      />
      {carrying.movedToast && <UndoToast message={carrying.toastMessage} onUndo={carrying.undoMove} />}
      <CardCarryOverlay
        carry={carrying.carry}
        label={(list) => (list.length > 1 ? `${list.length} шт.` : list[0].title)}
        icon="folder-outline"
        onEnterFolder={(p) => setPath(p)}
      />
      {create.nodes}
      {FEATURES.quickCreate && (
        <QuickCreateHost
          visible={quickOpen}
          onClose={() => setQuickOpen(false)}
          folder={path}
          onEnterFolder={(p) => setPath(p)}
          onTell={(message) => setToast({ id: Date.now(), message, left: 4 })}
        />
      )}
      <CreateFan
        visible={fanOpen}
        right={114}
        bottom={56 + insets.bottom}
        extra={[{ key: 'folder', icon: 'folder-outline', label: path ? 'Підпапка' : 'Нова папка', into: 'base' }]}
        onPick={fanPick}
        onChat={() => openCapture()}
        onClose={() => setFanOpen(false)}
      />
      {flattenPhotoNode}
      {downloadToast && (
        <DownloadToast
          fileName={downloadToast.fileName}
          onShowInFolder={() => {
            dismissDownloadToast();
            showDownloadedFile(downloadToast.uri, downloadToast.mimeType);
          }}
          onIgnore={dismissDownloadToast}
        />
      )}
      {toast && (
        <View style={[styles.toast, toastClear('right', insets.bottom)]}>
          <Text style={styles.toastText} numberOfLines={1}>
            {toast.message}
          </Text>
          {toast.undo && (
            <Pressable hitSlop={8} onPress={toast.undo}>
              <Text style={styles.toastUndo}>{`Скасувати (${toast.left})`}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  modernLines: { gap: 10, marginBottom: 12 },
  // A shorter column floats in the middle of its line, not pinned to the top (the user, 2026-10-12: «центруй їх по
  // центру, нехай трохи висить в повітрі»).
  // Both columns from the TOP (2026-10-15, the user's screenshot: «проблема зі зміщенням стовпців»): centred, the
  // shorter column stood half the difference lower - a hole above its first card.
  modernLine: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  // A column grows with the row but never past a card's largest size: the leftover goes to the row's right edge
  // (a pointer only - the phone's two columns share the whole width).
  modernCol: { flex: 1, gap: 10 },
  modernColCapped: { maxWidth: 260 },
  // The bin as a small card: the small folder card's own shape (ProjectFolders cardS).
  folders: { flexDirection: 'row', flexWrap: 'wrap', gap: FOLDER_GAP, marginBottom: 14 },
  playlistCard: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  collRow: { width: '100%' },
  folder: { width: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 22 },
  seat: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  folderName: { fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  folderCount: { fontSize: 12, fontFamily: SOFT_MEDIUM, marginTop: 1 },
  cardWrap: { marginBottom: 10 },
  tileLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  nativeCell: { flexDirection: 'row' },
  chipsBar: { position: 'absolute', left: 0, right: 0, height: 36 + 8, zIndex: 3, justifyContent: 'center' },
  chips: { paddingHorizontal: 20, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13.5, fontFamily: SOFT_SEMIBOLD },
  hint: { fontSize: 14, textAlign: 'center', marginTop: 40 },
  sectionLabel: { fontSize: 13, fontFamily: SOFT_SEMIBOLD, marginBottom: 10, marginLeft: 4 },
  pickedFrame: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderWidth: 2.5, borderRadius: 24 },
  check: { position: 'absolute', top: 12, right: 12, width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  toast: { position: 'absolute', backgroundColor: '#111827', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toastText: { color: '#fff', fontSize: 14, flexShrink: 1 },
  toastUndo: { color: '#93C5FD', fontSize: 14, fontFamily: SOFT_SEMIBOLD },
});

// THE OPENING'S OWN LAYER (navigation/folderOpening): it alone re-renders when a folder is tapped - the explorer does
// not - and the step into the folder is the closure the tap left in the store.
function FolderGrowLayer() {
  const { opening, ready } = useFolderOpening();
  if (!opening) return null;
  return (
    <GlassPortal priority={-1} name="folderGrow">
      <FolderGrow
        key={opening.path}
        tag={opening.tag}
        from={opening.from}
        ground={opening.ground}
        mine={opening.mine}
        subs={opening.subs}
        subNames={opening.subNames}
        onGrown={opening.onGrown}
        ready={ready}
        onDone={() => folderOpening.clear()}
      />
    </GlassPortal>
  );
}

// The pattern photographs wait while a folder opens (they take the UI thread in turns).
function FolderWarmup({ jobs, cover }: { jobs: ComponentProps<typeof PatternWarmup>['jobs']; cover: boolean }) {
  const { opening } = useFolderOpening();
  return <PatternWarmup jobs={jobs} paused={!!opening || cover} />;
}
