import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, deleteField, doc, onSnapshot } from '../firestore';
import { addDoc, setDoc } from '../utils/owned';
import {
  GRID_TILES,
  Tile,
  WIDE_TILES,
  openDatabaseTile,
  tileColorsDoc,
} from '../constants/databaseTiles';
import { useDatabaseTiles } from '../hooks/useDatabaseTiles';
import { PinnableItem, useDatabaseContents } from '../hooks/useDatabaseCounts';
import { deleteCustomDatabase } from '../utils/deleteCustomDatabase';
import { CustomDatabase } from '../types';
import {
  DEFAULT_TILE_SIZE,
  tileColumnsFor,
  packedSizes,
  layoutSections,
  cellAfter,
  tilesOverlap,
  parseTilePosition,
  formatTilePosition,
  type TilePosition,
  type PlacedTile,
  type BoardSection,
  TileSize,
  formatTileSize,
  packTiles,
  parseTileSize,
  snapTileSize,
} from '../utils/tileLayout';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { hapticButtonDown } from '../utils/haptics';
import * as ImagePicker from 'expo-image-picker';
import ImageCropper from '../components/ImageCropper';
import BackgroundStylist from '../components/BackgroundStylist';
import StockPhotoPicker from '../components/StockPhotoPicker';
import { db } from '../firebase';
import { RootStackParamList } from '../navigation';
import { TAG_COLORS } from '../constants/tags';
import { FONT_REGULAR, FONT_MEDIUM } from '../utils/fonts';
import { colorForDocument, contrastTextColor } from '../utils/documentColor';
import RenamePrompt from '../components/RenamePrompt';
import { ask, confirm, notify } from '../components/surfaces/Ask';
import ImportTableSheet from '../components/ImportTableSheet';
import ContentColumn from '../components/ContentColumn';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { NavigationContext } from '@react-navigation/native';
import { GlassPortalHost } from '../components/GlassPortal';
import { GlassTargetProvider } from '../components/GlassTarget';
import CustomDatabaseScreen from './CustomDatabaseScreen';
import DocumentsScreen from './DocumentsScreen';
import BoardsListScreen from './BoardsListScreen';
import LinksScreen from './LinksScreen';
import PhotosScreen from './PhotosScreen';
import FilesScreen from './FilesScreen';
import StickersScreen from './StickersScreen';
import TagManageScreen from './TagManageScreen';
import GroupsScreen from './GroupsScreen';
import DiaryScreen from './DiaryScreen';
import TasksScreen from './TasksScreen';
import { GLASS_BODY, GLASS_DANGER, GLASS_LINE, GLASS_TEXT, GLASS_TEXT_FAINT } from '../constants/glass';
import { BlurView } from 'expo-blur';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassPortal } from '../components/GlassPortal';
import { useBlurTarget } from '../components/GlassTarget';
import { GLASS_ISLAND } from '../constants/glass';
import { CAPSULE_DROP, CHROME_TOP, NAV_BOTTOM, RAIL_RIGHT, RAIL_WIDTH } from '../constants/rail';

const NEW_TILE_KEY = '__new__';
const PIN_TILE_KEY = '__pin__';
// A pinned group or smart folder is a tile like any other, keyed by what
// it points at - so its size, colour, picture and place on the board are
// remembered by the same documents as a database's.
const groupKey = (id: string) => `group:${id}`;
const tagKey = (id: string) => `tag:${id}`;
const IMPORT_TILE_KEY = '__import__';
const TILE_GAP = 10;
// The gap the tiles hold while they are being arranged - they draw apart
// to make room for the grips, and close back up when the board is done.
const TILE_GAP_EDITING = 16;
// The two colours this screen's own sheets speak in: the app's accent for
// "this one is on", and the danger red for the one row that destroys
// something.
const ACCENT = '#14B8A6';
const DANGER = GLASS_DANGER;
const tileSizesDoc = doc(db, 'settings', 'databaseTileSizes');
const tileOrderDoc = doc(db, 'settings', 'databaseTileOrder');
// The board has THREE views - the phone, the inner screen standing up, and
// lying down - and each keeps its own sizes and positions, under its own
// branch of this one document. The two older documents above are what a
// view falls back to while it has nothing of its own: the sizes as they
// were before the views, and the order, which still decides how the tiles
// that have no position flow.
const tileLayoutsDoc = doc(db, 'settings', 'databaseTileLayouts');
type TileView = 'phone' | 'portrait' | 'landscape';
const VIEW_LABEL: Record<TileView, string> = { phone: 'Телефон', portrait: 'Стоячи', landscape: 'Лежачи' };
// A divider: a named band across the whole board, splitting the tiles
// into sections. `y` is its order among the dividers (the row it last
// stood on) - where it actually stands is where its section starts,
// which the sections above decide. See layoutSections.
type TileDivider = { y: number; label: string };
const DIVIDER_HEIGHT = 34;
// A tile's key as a FIELD NAME. Firestore refuses any field name that
// begins and ends with two underscores - it keeps that shape for itself -
// and the three tiles that make things ("Нова база", "Імпорт таблиці",
// "Закріпити") are keyed exactly that way. So their places were thrown
// out on the way to the server and they were the three tiles that could
// not be moved at all.
const fieldKey = (key: string) => (key.startsWith('__') && key.endsWith('__') ? `tile_${key.slice(2, -2)}` : key);

type TileViewData = {
  sizes?: Record<string, string>;
  // A tile's place is relative to its section - the divider (by id) it
  // stands under; absent, the top of the board. See layoutSections.
  positions?: Record<string, string>;
  sections?: Record<string, string>;
  dividers?: Record<string, TileDivider>;
};
const tileBackgroundsDoc = doc(db, 'settings', 'databaseTileBackgrounds');
const tilePinsDoc = doc(db, 'settings', 'databaseTilePins');

type BoardItem =
  | { key: string; kind: 'builtin'; tile: Tile }
  | { key: string; kind: 'custom'; database: CustomDatabase }
  // A group or a smart folder the user has put on the board.
  | { key: string; kind: 'pin'; pin: PinnableItem; pinKind: 'group' | 'tag' }
  | { key: string; kind: 'action' };

// What a tile is before anyone resizes it: documents lead the board, the
// tasks run across under them, every database is a square, and the two
// tiles that make new ones are as small as a tile gets.
function defaultSizeFor(key: string): TileSize {
  if (key === 'documents') return { w: 4, h: 2 };
  if (key === 'tasks') return { w: 4, h: 1 };
  // Two cells across, not one: these two are buttons, and a button that
  // has room only for its icon says nothing about what it will do.
  if (key === NEW_TILE_KEY || key === IMPORT_TILE_KEY || key === PIN_TILE_KEY) return { w: 2, h: 1 };
  return DEFAULT_TILE_SIZE;
}

// The tiles a wide screen can open beside the board rather than instead
// of it. The rest - the tabs (documents, boards) and the placeholders -
// are whole screens of their own, not a database, so they still navigate.
type PaneTarget =
  | { kind: 'custom'; databaseId: string }
  | { kind: 'links'; category: 'video' | 'geo' | 'other' }
  | { kind: 'documents' }
  | { kind: 'boards' }
  // The three registries - the diary, the groups and the tags - open in
  // the pane like every other database now. They are not lists of records
  // and carry no chrome of their own; see PlainScreenShell.
  | { kind: 'route'; route: 'Photos' | 'Files' | 'Stickers' | 'Tasks' | 'Tags' | 'Groups' | 'Diary' };

function paneTargetFor(tile: Tile): PaneTarget | null {
  if (tile.linkCategory) return { kind: 'links', category: tile.linkCategory };
  // Documents and boards open here too now - every database in the same
  // place, which is the user's rule. They are tab ROOTS, so unlike the
  // rest they carry their own two-pane logic; `inPane` is how they are
  // told not to split again inside a half-width pane.
  if (tile.opensDocumentsTab) return { kind: 'documents' };
  if (tile.opensBoardsTab) return { kind: 'boards' };
  if (
    tile.route === 'Photos' ||
    tile.route === 'Files' ||
    tile.route === 'Stickers' ||
    tile.route === 'Tasks' ||
    tile.route === 'Tags' ||
    tile.route === 'Groups' ||
    tile.route === 'Diary'
  ) {
    return { kind: 'route', route: tile.route };
  }
  return null;
}

export default function DatabasesScreen() {
  const databasesBlurTarget = useBlurTarget();
  const databasesFocused = useIsFocused();
  const databasesInsets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const responsive = useResponsiveLayout();
  // Two panes only LYING DOWN. Standing up, half the inner screen is a
  // phone's width and a database in it is a database squeezed - the user's
  // rule: full width standing up, two windows lying down.
  const isTwoPane = responsive.isTwoPane && responsive.width >= responsive.height;
  // Which of the board's three views is on screen - see tileLayoutsDoc.
  const tileView: TileView = !responsive.isTwoPane ? 'phone' : isTwoPane ? 'landscape' : 'portrait';
  // What the left pane is showing, on a wide screen: a database opened
  // from a tile. On a phone the same tap navigates, as it always did.
  const [openInPane, setOpenInPane] = useState<PaneTarget | null>(null);
  const { colorFor, customDatabases } = useDatabaseTiles();
  // What is inside each database, for the tiles to show - see
  // useDatabaseContents.
  const { counts, latest, photoThumbs, pinnableGroups, pinnableTags } = useDatabaseContents();
  const [colorMenuKey, setColorMenuKey] = useState<string | null>(null);
  const [tileSizes, setTileSizes] = useState<Record<string, string>>({});
  const [tileLayouts, setTileLayouts] = useState<Partial<Record<TileView, TileViewData>>>({});
  const viewData = tileLayouts[tileView] ?? {};
  // Where the carried tile is, in cells, while the finger holds it.
  const [draftPosition, setDraftPosition] = useState<{ key: string; x: number; y: number } | null>(null);
  // Held-down, the board goes into its arranging state: the tiles draw
  // apart to make room for the grips, and nothing opens on a tap.
  const [editing, setEditing] = useState(false);
  const [boardWidth, setBoardWidth] = useState(0);
  // The size being dragged right now, so the board can re-pack around it
  // before the drag ends and it is written down.
  const [draftSize, setDraftSize] = useState<{ key: string; size: TileSize } | null>(null);
  // The order the user has arranged the board into, once they have. Until
  // then there is none, and the board keeps the order it was written in.
  const [order, setOrder] = useState<string[] | null>(null);
  // The tile being carried right now: where it is under the finger, and
  // the cell the board is placing it in while it is held there.
  const [drag, setDrag] = useState<{ key: string; x: number; y: number } | null>(null);
  // The cell the carried tile stood in when the finger went down, in
  // board pixels. The finger's travel is added to THIS, not to the cell
  // the tile is drawn in now - that cell follows the finger, so adding
  // the travel to it counted the travel twice and the tile ran a third
  // of the screen ahead of the hand.
  const carryOrigin = useRef({ x: 0, y: 0 });
  // A divider being carried: the row it is over, and where it is drawn
  // under the finger, in board pixels.
  const [draftDivider, setDraftDivider] = useState<{ id: string; y: number } | null>(null);
  const [dividerDrag, setDividerDrag] = useState<{ id: string; top: number } | null>(null);
  const dividerOrigin = useRef(0);
  const [dividerPrompt, setDividerPrompt] = useState<{ mode: 'new' } | { mode: 'rename'; id: string } | null>(null);
  // A picture behind a tile, cropped to that tile's own shape.
  const [tileBackgrounds, setTileBackgrounds] = useState<Record<string, string>>({});
  // The tile whose background is being chosen, and the picture waiting to
  // be cropped for it.
  const [backgroundFor, setBackgroundFor] = useState<{ key: string; aspect: number } | null>(null);
  const [cropping, setCropping] = useState<string | null>(null);
  // The cropped picture waiting to be toned to the tile's own colour, and
  // the search sheet - a second source for the same background, feeding
  // the same pipeline as the gallery.
  const [styling, setStyling] = useState<{ key: string; uri: string; color: string } | null>(null);
  const [searchingFor, setSearchingFor] = useState<{ key: string; aspect: number } | null>(null);
  const [searchedCropping, setSearchedCropping] = useState<string | null>(null);
  // Which groups and smart folders are on the board, and the sheet that
  // chooses them.
  const [pinnedKeys, setPinnedKeys] = useState<string[]>([]);
  const [pinSheetVisible, setPinSheetVisible] = useState(false);

  // While the board is being arranged, the tabs stop swiping. A grip
  // dragged sideways IS a horizontal drag, and the pager that carries the
  // tabs was taking it first - so a tile could be made taller but never
  // wider. Nothing else on this screen wants a sideways swipe anyway.
  useEffect(() => {
    navigation.setOptions({ swipeEnabled: !editing } as object);
  }, [editing, navigation]);

  useEffect(() => {
    return onSnapshot(tileSizesDoc, (snapshot) => {
      setTileSizes((snapshot.data() as Record<string, string> | undefined) ?? {});
    });
  }, []);
  useEffect(() => {
    return onSnapshot(
      tileLayoutsDoc,
      (snapshot) => setTileLayouts((snapshot.data() as Partial<Record<TileView, TileViewData>> | undefined) ?? {}),
      () => setTileLayouts({})
    );
  }, []);

  useEffect(() => {
    return onSnapshot(tilePinsDoc, (snapshot) => {
      const stored = snapshot.data()?.keys;
      setPinnedKeys(Array.isArray(stored) ? (stored as string[]) : []);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(tileBackgroundsDoc, (snapshot) => {
      setTileBackgrounds((snapshot.data() as Record<string, string> | undefined) ?? {});
    });
  }, []);

  useEffect(() => {
    return onSnapshot(tileOrderDoc, (snapshot) => {
      const stored = snapshot.data()?.order;
      setOrder(Array.isArray(stored) ? (stored as string[]) : null);
    });
  }, []);
  const [creatingDatabase, setCreatingDatabase] = useState(false);
  const [importing, setImporting] = useState(false);

  async function createDatabase(name: string) {
    setCreatingDatabase(false);
    const now = Date.now();
    const ref = await addDoc(collection(db, 'customDatabases'), {
      name,
      fields: [{ id: `${now}-title`, name: 'Назва', type: 'text' }],
      createdAt: now,
      updatedAt: now,
    });
    navigation.navigate('CustomDatabase', { databaseId: ref.id });
  }

  function pickColor(key: string, color: string) {
    // A database the user made carries its own colour, on its own record -
    // it is that database's colour everywhere in the app, not just this
    // tile's. The built-in ones have no record of their own, so theirs
    // lives in the shared tile-colours document.
    const own = customDatabases.find((database) => database.id === key);
    if (own) setDoc(doc(db, 'customDatabases', key), { color }, { merge: true });
    else setDoc(tileColorsDoc, { [key]: color }, { merge: true });
    setColorMenuKey(null);
  }

  // A tile's background: picked from the gallery, cropped to the shape
  // that tile actually is, and kept as its own file - so the picture is
  // the right shape once, rather than being re-fitted on every render.
  async function pickBackground(key: string, size: TileSize) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const aspect =
      (size.w * cellSize + (size.w - 1) * gap) / Math.max(1, size.h * cellSize + (size.h - 1) * gap);
    setBackgroundFor({ key, aspect });
    setCropping(result.assets[0].uri);
  }

  function saveBackground(uri: string) {
    if (backgroundFor) {
      setStyling({ key: backgroundFor.key, uri, color: resolveTileColor(backgroundFor.key) });
    }
    setCropping(null);
    setBackgroundFor(null);
  }

  // The colour a tile is showing right now - a custom database's own
  // colour, a pinned group/tag's colour, or the shared per-tile palette -
  // exactly the same three-way choice the tile itself renders with. What
  // a picked background is toned to, so it reads as that tile's picture
  // rather than carrying whatever hue it arrived with.
  function resolveTileColor(key: string): string {
    const database = customDatabases.find((d) => d.id === key);
    if (database) return database.color ?? colorForDocument(database.id).background;
    const group = pinnableGroups.find((g) => groupKey(g.id) === key);
    if (group) return group.color;
    const tag = pinnableTags.find((t) => tagKey(t.id) === key);
    if (tag) return tag.color;
    return colorFor(key);
  }

  function clearBackground(key: string) {
    setDoc(tileBackgroundsDoc, { [key]: deleteField() }, { merge: true });
    setColorMenuKey(null);
  }

  function togglePin(key: string) {
    const next = pinnedKeys.includes(key)
      ? pinnedKeys.filter((k) => k !== key)
      : [...pinnedKeys, key];
    setDoc(tilePinsDoc, { keys: next }, { merge: true });
  }

  // Back to the size this tile has when nobody has touched it. Written as
  // a deletion rather than the default value, so a later change of mind
  // about defaults reaches it.
  function resetSize(key: string) {
    writeSize(key, null);
    setColorMenuKey(null);
  }

  // Repaints every tile at once - random, but not a random colour per
  // tile, which is what "random" alone would give and what would make the
  // board look scattered.
  //
  // The palette is dealt like a deck instead: shuffled once, then handed
  // out in turn down the board's own order and reshuffled when it runs
  // out. Every colour is therefore used about equally often, and two
  // tiles side by side can only match across a whole cycle of the
  // palette - which is what "гармонійно" means here, and it is a property
  // of the dealing rather than of any check afterwards.
  //
  // Only tiles that HAVE a colour: the three action tiles are glass.
  function resetColors() {
    confirm({
      title: 'Скинути кольори?',
      message: 'Плитки будуть розфарбовані наново - випадково, але в нашій гамі. Розміри, порядок і фонові зображення лишаться.',
      confirmLabel: 'Розфарбувати',
      tone: 'primary',
    }).then((yes) => {
      if (!yes) return;
      const keys = boardItems.filter((item) => item.kind !== 'action').map((item) => item.key);
      let deck: string[] = [];
      const next: Record<string, string> = {};
      keys.forEach((key) => {
        if (deck.length === 0) {
          deck = [...TAG_COLORS];
          // Fisher-Yates, so every ordering of the deck is as likely as
          // any other - a sort() with a random comparator is not a
          // shuffle and biases towards the order it started in.
          for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
          }
        }
        next[key] = deck.pop()!;
      });
      // A database the user made carries its own colour on its own record
      // - the same split pickColor makes, for the same reason: that
      // colour is the database's everywhere in the app, not this tile's.
      const own = new Set(customDatabases.map((database) => database.id));
      const shared: Record<string, string> = {};
      Object.entries(next).forEach(([key, color]) => {
        if (own.has(key)) setDoc(doc(db, 'customDatabases', key), { color }, { merge: true });
        else shared[key] = color;
      });
      setDoc(tileColorsDoc, shared, { merge: true });
      setColorMenuKey(null);
    });
  }

  // Sizes chosen so the board has no gaps - see packedSizes. Written in
  // the order the tiles are actually in, since that is the order they are
  // packed in.
  function fillBoard() {
    setColorMenuKey(null);
    // The sizes that fill the board, and then WHERE each one lands with
    // those sizes - written as positions too, so the result stays put
    // instead of flowing again the next time anything changes.
    // Section by section: a divider is a wall the filling does not cross.
    const sizes: Record<string, string> = {};
    const positions: Record<string, string> = {};
    groupSections(orderedItems).forEach((section) => {
      const own = packedSizes(section.items.map((item) => item.key), columns);
      Object.entries(own).forEach(([key, value]) => {
        sizes[fieldKey(key)] = value;
      });
      const { placed: laid } = packTiles(
        section.items,
        (item) => parseTileSize(own[item.key]) ?? sizeFor(item.key),
        undefined,
        columns
      );
      laid.forEach((p) => {
        positions[p.item.key] = formatTilePosition({ x: p.x, y: p.y });
      });
    });
    setDoc(tileLayoutsDoc, { [tileView]: { sizes, positions } }, { merge: true });
  }

  function resetBoard() {
    confirm({
      title: 'Скинути дошку?',
      message: 'Розміри, порядок плиток і розділювачі повернуться до стандартних. Кольори й фони лишаться.',
      confirmLabel: 'Скинути',
    }).then((yes) => {
      if (!yes) return;
      // This view goes back to defaults. The order and the sizes from
      // before the views are cleared too, since they are what a view with
      // nothing of its own shows.
      setDoc(tileLayoutsDoc, { [tileView]: deleteField() }, { merge: true });
      setDoc(tileSizesDoc, {}, { merge: false });
      setDoc(tileOrderDoc, { order: deleteField() }, { merge: true });
    });
  }

  function confirmDeleteDatabase(database: CustomDatabase) {
    setColorMenuKey(null);
    confirm({
      title: `Видалити «${database.name}»?`,
      message: 'База, всі її записи та збережені вигляди зникнуть. Це не можна відмінити.',
      confirmLabel: 'Видалити',
    }).then((yes) => {
      if (!yes) return;
      deleteCustomDatabase(database.id).catch((error) =>
        notify('Не вдалося видалити', (error as Error).message)
      );
    });
  }

  function openTile(tile: Tile) {
    // Documents and boards are doors like every other tile, not shortcuts
    // to their tab: a copy opens on top and back returns here. (Lying down
    // on the inner screen they open in the pane instead - see onPress.)
    if (tile.opensDocumentsTab) {
      navigation.navigate('DocumentsCopy');
      return;
    }
    if (tile.opensBoardsTab) {
      navigation.navigate('BoardsCopy');
      return;
    }
    openDatabaseTile(navigation, tile);
  }

  // ---- the tile board ------------------------------------------------
  // Every database is a tile on a four-column grid, and each one remembers
  // how big it is. Sizes live in their own settings document, keyed the
  // same way the colours are.
  function sizeFor(key: string): TileSize {
    // While a grip is being dragged, the board packs around the size the
    // finger is asking for - that is what makes the other tiles move out
    // of the way under the hand rather than after it.
    if (draftSize?.key === key) return draftSize.size;
    // This view's own size; before it has one, the size from before the
    // views existed; before that, the default.
    return parseTileSize(viewData.sizes?.[fieldKey(key)]) ?? parseTileSize(tileSizes[key]) ?? defaultSizeFor(key);
  }

  // Where the user put this tile in THIS view, relative to its section,
  // and the divider that section stands under ('' for the top of the
  // board). A divider that is gone takes its tiles back to the top.
  function storedPosition(key: string): TilePosition | null {
    return parseTilePosition(viewData.positions?.[fieldKey(key)]);
  }
  function storedSection(key: string): string {
    const id = viewData.sections?.[fieldKey(key)];
    return id && viewData.dividers?.[id] ? id : '';
  }
  const dividerIds = Object.entries(viewData.dividers ?? {})
    .sort((a, b) => a[1].y - b[1].y || a[0].localeCompare(b[0]))
    .map(([id]) => id);
  function groupSections(items: BoardItem[], member = sectionOf): BoardSection<BoardItem>[] {
    return [
      { id: '', items: items.filter((item) => member(item.key) === '') },
      ...dividerIds.map((id) => ({ id, items: items.filter((item) => member(item.key) === id) })),
    ];
  }

  // A dropped tile takes its cell, and any tile it now lies over keeps
  // the place it was pushed to under the hand - written down, so the two
  // do not fight over the cell on every render afterwards. Written as a
  // place, not cleared: a cleared tile would flow to the top of the
  // board, which is the "my tiles wander off to fill holes" the user saw.
  function setPosition(dropped: PlacedTile<BoardItem>, board: PlacedTile<BoardItem>[]) {
    const section = sectionOf(dropped.item.key);
    const positions: Record<string, string> = {
      [fieldKey(dropped.item.key)]: formatTilePosition(relOf(dropped)),
    };
    // Which side of the dividers it came down on - it may have been
    // carried across one.
    const sections: Record<string, string | ReturnType<typeof deleteField>> = {
      [fieldKey(dropped.item.key)]: section || deleteField(),
    };
    board.forEach((p) => {
      if (p.item.key === dropped.item.key || sectionOf(p.item.key) !== section) return;
      const stored = parseTilePosition(viewData.positions?.[fieldKey(p.item.key)]);
      if (!stored) return;
      const rect = { item: p.item, x: stored.x, y: stored.y + startOf(section), size: p.size };
      if (tilesOverlap(dropped, rect)) positions[fieldKey(p.item.key)] = formatTilePosition(relOf(p));
    });
    setDoc(tileLayoutsDoc, { [tileView]: { positions, sections } }, { merge: true });
  }

  // Built in first, then the databases the user made, then the two tiles
  // that make more - the same order the screen has always had.
  const pinnedTiles: BoardItem[] = pinnedKeys
    .map((key): BoardItem | null => {
      if (key.startsWith('group:')) {
        const pin = pinnableGroups.find((g) => groupKey(g.id) === key);
        return pin ? { key, kind: 'pin', pin, pinKind: 'group' } : null;
      }
      const pin = pinnableTags.find((t) => tagKey(t.id) === key);
      return pin ? { key, kind: 'pin', pin, pinKind: 'tag' } : null;
    })
    .filter((item): item is BoardItem => !!item);

  const boardItems: BoardItem[] = [
    ...WIDE_TILES.map((tile) => ({ key: tile.key, kind: 'builtin' as const, tile })),
    ...GRID_TILES.map((tile) => ({ key: tile.key, kind: 'builtin' as const, tile })),
    ...customDatabases.map((database) => ({ key: database.id, kind: 'custom' as const, database })),
    ...pinnedTiles,
    { key: NEW_TILE_KEY, kind: 'action' as const },
    { key: IMPORT_TILE_KEY, kind: 'action' as const },
    { key: PIN_TILE_KEY, kind: 'action' as const },
  ];
  // The arranged order wins where there is one; anything it does not
  // mention (a database made since) keeps its natural place at the end.
  const activeOrder = order;
  const orderedItems = activeOrder
    ? [
        ...activeOrder
          .map((key) => boardItems.find((item) => item.key === key))
          .filter((item): item is BoardItem => !!item),
        ...boardItems.filter((item) => !activeOrder.includes(item.key)),
      ]
    : boardItems;

  // The rule only means anything while the board is in the order it was
  // written in: once the tiles have been arranged, "everything above is
  // built in" is no longer true, and a line drawn there would be a lie.
  const showRule = !activeOrder && !viewData.positions;
  const firstOwnKey = customDatabases[0]?.id ?? NEW_TILE_KEY;
  // A cell is square, and the board is as wide as the column it sits in.
  // While arranging, the gap grows: the tiles draw apart to make room for
  // the grips, and close back up into a dense board when it is done.
  const gap = editing ? TILE_GAP_EDITING : TILE_GAP;
  // More columns on a wider board, not bigger cells - see tileColumnsFor.
  // A tile's size is stored in cells, so a cell that stays the same size
  // is a tile that stays the same size, and the packing below simply
  // finds it a new place among more of them.
  const columns = tileColumnsFor(boardWidth, gap);
  const cellSize = boardWidth > 0 ? (boardWidth - gap * (columns - 1)) / columns : 0;
  const cellStep = cellSize + gap;
  const spanSize = (cells: number) => cells * cellSize + (cells - 1) * gap;

  const breakAt = (item: BoardItem) => showRule && item.key === firstOwnKey;
  // The board as it stands, with nothing in the hand: what the rows of
  // the dividers are measured off. The tile being carried is resolved
  // against THESE rows - which section it is now over, and where in it -
  // so that a tile can be carried across a divider into the section on
  // the other side. A divider stops a tile only when the board moves it
  // ITSELF: growth and filling stay inside a section (layoutSections).
  const baseBoard = layoutSections(
    groupSections(orderedItems, storedSection),
    (item) => sizeFor(item.key),
    (item) => storedPosition(item.key),
    columns,
    breakAt
  );
  const draftAt = (() => {
    if (!draftPosition) return null;
    let section = '';
    let start = 0;
    for (const id of dividerIds) {
      const row = baseBoard.sections.find((s) => s.id === id)?.start ?? 0;
      if (row > draftPosition.y) break;
      section = id;
      start = row;
    }
    return { key: draftPosition.key, section, x: draftPosition.x, y: Math.max(0, draftPosition.y - start) };
  })();
  function positionFor(key: string): TilePosition | null {
    if (draftAt?.key === key) return { x: draftAt.x, y: draftAt.y };
    return storedPosition(key);
  }
  function sectionOf(key: string): string {
    return draftAt?.key === key ? draftAt.section : storedSection(key);
  }
  const pinnedAt = (item: BoardItem) => positionFor(item.key);
  const carriedFirst = (item: BoardItem) => item.key === draftPosition?.key;
  // The board with one tile at a given size - the size a grip is asking
  // for, or the one it just let go at. Every placed tile after that one
  // is allowed to settle towards it (placeTiles), so the space it frees
  // is taken as it frees it - the user's complaint was tiles standing
  // still beside a hole "поки я не перетягну". Which tiles are "after"
  // is read off a placement made with the new size.
  // Settling stays inside the resized tile's own section: a divider is a
  // wall. `without` leaves one tile off the board - the carried one, to
  // measure the room its section has for it.
  function boardWith(key: string | null, size: TileSize | null, without?: string) {
    const items = without ? orderedItems.filter((item) => item.key !== without) : orderedItems;
    const sizeOf = (item: BoardItem) => (item.key === key && size ? size : sizeFor(item.key));
    const groups = groupSections(items);
    const run = (settleFrom?: (item: BoardItem) => TilePosition | null) =>
      layoutSections(groups, sizeOf, pinnedAt, columns, breakAt, carriedFirst, settleFrom);
    if (!key) return run();
    const trial = run();
    const anchor = trial.placed.find((p) => p.item.key === key);
    if (!anchor) return trial;
    const section = sectionOf(key);
    const anchorRel = { x: anchor.x, y: anchor.y - (trial.sections.find((s) => s.id === section)?.start ?? 0) };
    return run((item) => {
      if (item.key === key || sectionOf(item.key) !== section) return null;
      const position = pinnedAt(item);
      return position && cellAfter(anchorRel, position) ? anchorRel : null;
    });
  }
  const board = boardWith(draftSize?.key ?? null, draftSize?.size ?? null);
  const { placed, rows } = board;
  const placedOf = (key: string) => placed.find((p) => p.item.key === key);
  const startOf = (section: string) => board.sections.find((s) => s.id === section)?.start ?? 0;
  // A tile's place as it is stored: relative to its section.
  const relOf = (p: PlacedTile<BoardItem>): TilePosition => ({ x: p.x, y: p.y - startOf(sectionOf(p.item.key)) });
  const ruleRow = showRule ? placedOf(firstOwnKey)?.y ?? 0 : 0;

  // The dividers as they stand: each at the start of its section.
  const dividers = board.sections.slice(1).map((section) => ({
    id: section.id,
    label: viewData.dividers?.[section.id]?.label ?? '',
    y: section.start,
  }));
  // Where a row starts, in board pixels: its cells, plus one band for
  // every divider standing above it. `without` leaves one divider out -
  // the one being carried, so the rows it is measured against do not
  // shift under it as it passes them.
  const rowTop = (y: number, without?: string) =>
    y * cellStep + dividers.filter((d) => d.y <= y && d.id !== without).length * DIVIDER_HEIGHT;
  // Where a row starts on the board as it stood BEFORE anything was
  // picked up - what a finger is measured against.
  //
  // It cannot be the live board. A tile carried below a divider makes
  // the section it left shorter, which pulls the divider up, which moves
  // every row under the finger - so the next move read the finger as
  // being above the divider again, and the tile sprang back. The board
  // the finger is measured on has to stand still while it moves, the
  // same reason the carry remembers where it started (carryOrigin).
  const baseDividers = baseBoard.sections.slice(1).map((section) => ({ id: section.id, y: section.start }));
  const baseRowTop = (y: number, without?: string) =>
    y * cellStep + baseDividers.filter((d) => d.y <= y && d.id !== without).length * DIVIDER_HEIGHT;
  // The row nearest a board pixel, counting the row below the last one.
  const rowUnder = (py: number, without?: string) => {
    let best = 0;
    for (let r = 0; r <= baseBoard.rows + 1; r += 1) {
      if (Math.abs(baseRowTop(r, without) - py) < Math.abs(baseRowTop(best, without) - py)) best = r;
    }
    return best;
  };
  // A divider's band: from the end of the row above it (the gap is part
  // of the band) to the start of the row it stands over.
  const dividerTop = (index: number) =>
    dividers[index].y * cellStep - gap + index * DIVIDER_HEIGHT;
  const boardHeight =
    rows * cellStep - gap + dividers.length * DIVIDER_HEIGHT + (dividers.some((d) => d.y >= rows) ? gap : 0);

  function writeDivider(id: string, data: Partial<TileDivider> | null) {
    setDoc(tileLayoutsDoc, { [tileView]: { dividers: { [id]: data ?? deleteField() } } }, { merge: true });
  }

  async function editDivider(id: string) {
    const divider = viewData.dividers?.[id];
    if (!divider) return;
    const choice = await ask({
      title: divider.label || 'Розділювач',
      actions: [
        { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' },
        { id: 'delete', label: 'Видалити', icon: 'trash-outline', tone: 'danger' },
      ],
    });
    if (choice === 'rename') setDividerPrompt({ mode: 'rename', id });
    // Its section joins the one above: the tiles keep their rows, only
    // the wall between them goes.
    if (choice === 'delete') repartition(dividers.filter((d) => d.id !== id), id);
  }

  // The sections drawn anew from where the dividers now stand: every
  // tile goes to the section of the last divider above its row, with
  // its place measured from that divider. Written for every tile, so
  // that a tile that was still flowing is pinned where it was.
  function repartition(walls: { id: string; y: number }[], remove?: string) {
    const bounds = [...walls].sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
    const positions: Record<string, string> = {};
    const sections: Record<string, string | ReturnType<typeof deleteField>> = {};
    const walled: Record<string, { y: number } | ReturnType<typeof deleteField>> = {};
    const mine = placed.map((p) => {
      let owner = '';
      for (const wall of bounds) {
        if (wall.y > p.y) break;
        owner = wall.id;
      }
      return { key: p.item.key, x: p.x, y: p.y, owner };
    });
    // A section starts at its own topmost tile, not at the wall above it.
    // Otherwise every drag of a divider left a blank row at the top of
    // the section below - and because that row made the section taller,
    // it pushed the tiles down again on the next drag, a row each time.
    const top = new Map<string, number>();
    mine.forEach((p) => {
      const known = top.get(p.owner);
      if (known === undefined || p.y < known) top.set(p.owner, p.y);
    });
    mine.forEach((p) => {
      positions[fieldKey(p.key)] = formatTilePosition({ x: p.x, y: p.y - (top.get(p.owner) ?? p.y) });
      sections[fieldKey(p.key)] = p.owner || deleteField();
    });
    bounds.forEach((wall) => {
      walled[wall.id] = { y: wall.y };
    });
    if (remove) walled[remove] = deleteField();
    setDoc(tileLayoutsDoc, { [tileView]: { positions, sections, dividers: walled } }, { merge: true });
  }

  function saveDividerName(label: string) {
    const prompt = dividerPrompt;
    setDividerPrompt(null);
    if (!prompt) return;
    const name = label.trim();
    if (prompt.mode === 'rename') {
      writeDivider(prompt.id, { label: name });
      return;
    }
    // A new divider stands under the last row; the user carries it to
    // where it belongs.
    writeDivider(`d${Date.now().toString(36)}`, { y: rows, label: name });
  }

  // A resize is written down together with the places the tiles after
  // it settled into - the same thing the finger saw while resizing,
  // kept. Written as places, not cleared: a cleared tile would flow to
  // the top of the board the next time anything moved.
  function writeSize(key: string, size: TileSize | null) {
    const settled = boardWith(key, size ?? defaultSizeFor(key)).placed;
    const positions: Record<string, string> = {};
    settled.forEach((p) => {
      if (p.item.key === key) return;
      const stored = parseTilePosition(viewData.positions?.[fieldKey(p.item.key)]);
      const rel = relOf(p);
      if (stored && (stored.x !== rel.x || stored.y !== rel.y)) {
        positions[fieldKey(p.item.key)] = formatTilePosition(rel);
      }
    });
    setDoc(
      tileLayoutsDoc,
      { [tileView]: { sizes: { [fieldKey(key)]: size ? formatTileSize(size) : deleteField() }, positions } },
      { merge: true }
    );
  }

  // The cell under the finger, for a tile of this size: the column is
  // clamped so the tile stays on the board. That cell is the tile's
  // position while it is carried, and its position for good once let go
  // - it does not flow anywhere afterwards. The others make room by
  // flowing around it (placeTiles), which is the control the user asked
  // for: "щоб плитка вела себе... а не так, що я її не контролюю".
  //
  // The row is the board's own, not a section's: a finger may carry a
  // tile across a divider, and which section it then belongs to is read
  // off where it landed (draftAt). Only the board moving a tile by
  // itself - a resize, a fill - is stopped by a divider.
  function cellUnder(key: string, x: number, y: number): TilePosition {
    const size = sizeFor(key);
    const col = Math.max(0, Math.min(columns - size.w, Math.round(x / cellStep)));
    return { x: col, y: rowUnder(y) };
  }



  // The real navigation with one thing changed: going back closes the
  // pane. Built with Object.create so every method the navigator put on
  // the original is still reachable through the prototype - spreading it
  // would copy the own properties and quietly drop the rest.
  const paneNavigation = useMemo(() => {
    const proxy = Object.create(navigation);
    proxy.goBack = () => setOpenInPane(null);
    return proxy;
  }, [navigation]);

  const boardScroll = (
          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingTop: databasesInsets.top + CHROME_TOP + 8 },
            ]}
          >
            {/* The board. Tiles are placed, not flowed - see packTiles for
                why a wrapping row cannot hold mixed sizes without leaving
                holes. Each one animates to its new cell whenever the packing
                changes, which is what makes a resize look like the board
                closing up around it rather than everything jumping. */}
            <View
              style={[styles.board, { height: Math.max(0, boardHeight) }]}
              onLayout={(e) => setBoardWidth(e.nativeEvent.layout.width)}
            >
              {/* Everything above is built in; everything below is yours. */}
              {showRule && ruleRow > 0 && (
                <View style={[styles.boardRule, { top: rowTop(ruleRow) - gap / 2 }]} />
              )}

              {cellSize > 0 &&
                dividers.map((divider, index) => (
                  <BoardDivider
                    key={divider.id}
                    label={divider.label}
                    top={dividerDrag?.id === divider.id ? dividerDrag.top : Math.max(0, dividerTop(index))}
                    height={DIVIDER_HEIGHT + (divider.y === 0 ? 0 : gap)}
                    editing={editing}
                    carried={dividerDrag?.id === divider.id}
                    onEdit={() => editDivider(divider.id)}
                    onCarryStart={() => {
                      hapticButtonDown();
                      dividerOrigin.current = Math.max(0, dividerTop(index));
                      setDividerDrag({ id: divider.id, top: dividerOrigin.current });
                      setDraftDivider({ id: divider.id, y: divider.y });
                    }}
                    onCarryMove={(dy) => {
                      const top = dividerOrigin.current + dy;
                      setDividerDrag({ id: divider.id, top });
                      // The band's lower edge is where the row it stands over
                      // begins - that is what is matched to a row.
                      setDraftDivider({ id: divider.id, y: rowUnder(top + gap, divider.id) });
                    }}
                    onCarryEnd={() => {
                      const dropped = draftDivider;
                      setDividerDrag(null);
                      setDraftDivider(null);
                      if (dropped) {
                        repartition(dividers.map((d) => (d.id === dropped.id ? { id: d.id, y: dropped.y } : d)));
                      }
                    }}
                  />
                ))}

              {cellSize > 0 &&
                placed.map(({ item, x, y, size }) => (
                  <BoardTile
                    key={item.key}
                    item={item}
                    left={x * cellStep}
                    top={rowTop(y)}
                    width={spanSize(size.w)}
                    height={spanSize(size.h)}
                    color={
                      item.kind === 'custom'
                        ? item.database.color ?? colorForDocument(item.database.id).background
                        : item.kind === 'pin'
                          ? item.pin.color
                          : colorFor(item.key)
                    }
                    editing={editing}
                    cellSize={cellSize}
                    size={size}
                    background={tileBackgrounds[item.key]}
                    count={item.kind === 'pin' ? item.pin.count : counts[item.key]}
                    latest={latest[item.key]}
                    thumbs={item.key === 'photos' ? photoThumbs : undefined}
                    onOpen={() => {
                      // On a wide screen a database opens BESIDE the board,
                      // in the left pane, rather than replacing it.
                      const pane =
                        item.kind === 'builtin'
                          ? paneTargetFor(item.tile)
                          : item.kind === 'custom'
                            ? ({ kind: 'custom', databaseId: item.database.id } as const)
                            : null;
                      if (isTwoPane && pane) {
                        setColorMenuKey(null);
                        setOpenInPane(pane);
                        return;
                      }
                      if (item.kind === 'builtin') openTile(item.tile);
                      else if (item.kind === 'custom')
                        navigation.navigate('CustomDatabase', { databaseId: item.database.id });
                      else if (item.kind === 'pin') {
                        // A group opens the documents with that group
                        // chosen - and everything else in it follows under
                        // the rule there (see GroupSections). A smart folder
                        // opens its own list, which is already cross-database.
                        if (item.pinKind === 'group')
                          navigation.navigate('Tabs', {
                            screen: 'Документи',
                            params: { groupId: item.pin.id },
                          });
                        else navigation.navigate('TagItems', { tagId: item.pin.id });
                      } else if (item.key === NEW_TILE_KEY) setCreatingDatabase(true);
                      else if (item.key === PIN_TILE_KEY) setPinSheetVisible(true);
                      else setImporting(true);
                    }}
                    onHold={() => {
                      hapticButtonDown();
                      setEditing(true);
                      // On a wide screen the settings have a pane waiting
                      // for them, so the tile that was held goes straight
                      // into it - one gesture, not hold-then-tap.
                      if (isTwoPane) setColorMenuKey(item.key);
                    }}
                    onColor={() => setColorMenuKey(item.key)}
                    onResize={(next) => setDraftSize({ key: item.key, size: next })}
                    onResizeEnd={(next) => {
                      setDraftSize(null);
                      writeSize(item.key, next);
                    }}
                    carried={drag?.key === item.key ? { x: drag.x, y: drag.y } : null}
                    onCarryStart={() => {
                      hapticButtonDown();
                      carryOrigin.current = { x: x * cellStep, y: rowTop(y) };
                      setDrag({ key: item.key, x: x * cellStep, y: rowTop(y) });
                      setDraftPosition({ key: item.key, x, y });
                    }}
                    onCarryMove={(dx, dy) => {
                      const nextX = carryOrigin.current.x + dx;
                      const nextY = carryOrigin.current.y + dy;
                      setDrag({ key: item.key, x: nextX, y: nextY });
                      const cell = cellUnder(item.key, nextX, nextY);
                      setDraftPosition({ key: item.key, x: cell.x, y: cell.y });
                    }}
                    onCarryEnd={() => {
                      const dropped = draftPosition ? placedOf(draftPosition.key) : undefined;
                      setDrag(null);
                      setDraftPosition(null);
                      if (dropped) setPosition(dropped, placed);
                    }}
                  />
                ))}
            </View>
          </ScrollView>
  );

  const tileMenu = (
    <>
              <Text style={styles.colorMenuTitle}>Плитка · {VIEW_LABEL[tileView]}</Text>
              <View style={styles.colorMenuRow}>
                {TAG_COLORS.map((color) => (
                  <Pressable key={color} onPress={() => colorMenuKey && pickColor(colorMenuKey, color)}>
                    <View style={[styles.colorSwatch, { backgroundColor: color }]} />
                  </Pressable>
                ))}
              </View>
              <Pressable
                style={styles.sheetRow}
                onPress={() => {
                  const key = colorMenuKey;
                  setColorMenuKey(null);
                  if (!key) return;
                  ask({
                    title: 'Звідки взяти зображення?',
                    actions: [
                      { id: 'gallery', label: 'Галерея', icon: 'images-outline' },
                      { id: 'stock', label: 'Пошук зображень', icon: 'search-outline' },
                    ],
                  }).then((answer) => {
                    if (answer === 'gallery') pickBackground(key, sizeFor(key));
                    if (answer === 'stock') {
                      const size = sizeFor(key);
                      const aspect =
                        (size.w * cellSize + (size.w - 1) * gap) /
                        Math.max(1, size.h * cellSize + (size.h - 1) * gap);
                      setSearchingFor({ key, aspect });
                    }
                  });
                }}
              >
                <Ionicons name="image-outline" size={17} color={GLASS_TEXT} />
                <Text style={styles.sheetRowLabel}>
                  {colorMenuKey && tileBackgrounds[colorMenuKey] ? 'Змінити фон' : 'Фонове зображення'}
                </Text>
              </Pressable>
              {colorMenuKey && tileBackgrounds[colorMenuKey] && (
                <Pressable style={styles.sheetRow} onPress={() => clearBackground(colorMenuKey)}>
                  <Ionicons name="image-outline" size={17} color={GLASS_TEXT} />
                  <Text style={styles.sheetRowLabel}>Прибрати фон</Text>
                </Pressable>
              )}
              {colorMenuKey && (
                <Pressable style={styles.sheetRow} onPress={() => resetSize(colorMenuKey)}>
                  <Ionicons name="resize-outline" size={17} color={GLASS_TEXT} />
                  <Text style={styles.sheetRowLabel}>Стандартний розмір</Text>
                </Pressable>
              )}
              {/* A pinned group or folder is taken off the board here -
                  nothing about the group itself is touched. */}
              {colorMenuKey && pinnedKeys.includes(colorMenuKey) && (
                <Pressable
                  style={styles.sheetRow}
                  onPress={() => {
                    togglePin(colorMenuKey);
                    setColorMenuKey(null);
                  }}
                >
                  <Ionicons name="remove-circle-outline" size={17} color={GLASS_TEXT} />
                  <Text style={styles.sheetRowLabel}>Відкріпити з дошки</Text>
                </Pressable>
              )}
              {/* Only a database the user made can be deleted, and only
                  from here - the built-in ones are the app itself. */}
              {colorMenuKey && customDatabases.some((d) => d.id === colorMenuKey) && (
                <Pressable
                  style={styles.sheetRow}
                  onPress={() => {
                    const database = customDatabases.find((d) => d.id === colorMenuKey);
                    if (database) confirmDeleteDatabase(database);
                  }}
                >
                  <Ionicons name="trash-outline" size={17} color={DANGER} />
                  <Text style={[styles.sheetRowLabel, { color: DANGER }]}>Видалити базу</Text>
                </Pressable>
              )}
              <View style={styles.sheetRule} />
              {/* Beside "Скинути дошку" because it is the same kind of
                  act - the whole board at once, not this one tile - and
                  this is where the board's own actions already live. */}
              <Pressable style={styles.sheetRow} onPress={resetColors}>
                <Ionicons name="color-palette-outline" size={17} color={GLASS_TEXT} />
                <Text style={styles.sheetRowLabel}>Скинути кольори</Text>
              </Pressable>
              {/* Every tile given the widest size that still fits the gap
                  in front of it, row by row - so the board comes out solid
                  instead of pitted with the holes a hand-picked one fills
                  up with. */}
              <Pressable style={styles.sheetRow} onPress={fillBoard}>
                <Ionicons name="grid-outline" size={17} color={GLASS_TEXT} />
                <Text style={styles.sheetRowLabel}>Заповнити без дірок</Text>
              </Pressable>
              <Pressable
                style={styles.sheetRow}
                onPress={() => {
                  setColorMenuKey(null);
                  resetBoard();
                }}
              >
                <Ionicons name="refresh-outline" size={17} color={GLASS_TEXT} />
                <Text style={styles.sheetRowLabel}>Скинути дошку</Text>
              </Pressable>
    </>
  );

  return (
    <View style={styles.container}>
      {/* Same fixed gradient as Documents/Calendar. 1px bled past every edge
          (see the -1/+2 below) - windowWidth/Height can round to a hair
          less than the actual screen, leaving a sliver of the default
          white background visible at an edge otherwise. */}
      <Svg
        width={windowWidth + 2}
        height={windowHeight + 2}
        style={[StyleSheet.absoluteFill, { top: -1, left: -1 }]}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="databasesBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth + 2} height={windowHeight + 2} fill="url(#databasesBg)" />
      </Svg>
      {/* The rail, as on every other screen: right edge, same width, same
          glass, hanging from the same line. Through the portal for the
          blur, so it withdraws when this screen isn't the one on show. */}
      {databasesFocused && (
        <GlassPortal>
          <View
            style={[styles.railWrap, { top: databasesInsets.top + CHROME_TOP + CAPSULE_DROP }]}
            pointerEvents="box-none"
          >
            <View style={styles.headerButtons}>
              <BlurView
                intensity={60}
                tint="dark"
                blurMethod="dimezisBlurView"
                blurTarget={databasesBlurTarget ?? undefined}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <Pressable hitSlop={8} onPress={() => navigation.navigate('Search')}>
                <Ionicons name="search-outline" size={24} color="#fff" />
              </Pressable>
              <View style={styles.headerButtonsDivider} />
              <Pressable hitSlop={8} onPress={() => navigation.navigate('Settings')}>
                <Ionicons name="ellipsis-horizontal-outline" size={24} color="#fff" />
              </Pressable>
            </View>
          </View>
        </GlassPortal>
      )}

      {/* On a wide screen the tile's menu is not a window over the board
          - it is the other half of it. The board keeps the right side,
          against the rail that belongs to it (the same reasoning as the
          documents list), and the menu takes the left.
          
          Outside ContentColumn on purpose: that column caps content at a
          readable 760, which is right for one column of tiles and wrong
          for two panes, which should have the whole unfolded screen. */}
      {/* The tiles take the WHOLE unfolded screen until something is
          actually open beside them. Half of it spent on "torkny plytky"
          was half a screen spent on an instruction - the same thing the
          documents list stopped doing. */}
      {isTwoPane && !openInPane && !colorMenuKey ? (
        boardScroll
      ) : isTwoPane ? (
        <View style={styles.paneRow}>
          <View style={styles.boardPane}>{boardScroll}</View>
          <View style={colorMenuKey ? styles.menuPane : styles.databasePane}>
            {colorMenuKey ? (
              <ScrollView contentContainerStyle={styles.menuPaneCard}>{tileMenu}</ScrollView>
            ) : openInPane ? (
              // Its own portal host and blur target, which is the whole
              // trick: a screen's rail, its tabs and its sheets all draw
              // through the NEAREST host, so inside this one they stay in
              // this pane instead of spreading across the window. And its
              // own navigation, whose goBack closes the pane rather than
              // walking off the board.
              <GlassPortalHost>
                <GlassTargetProvider>
                  <NavigationContext.Provider value={paneNavigation}>
                    {openInPane.kind === 'custom' ? (
                      <CustomDatabaseScreen databaseId={openInPane.databaseId} inPane />
                    ) : openInPane.kind === 'documents' ? (
                      <DocumentsScreen inPane />
                    ) : openInPane.kind === 'boards' ? (
                      <BoardsListScreen inPane />
                    ) : openInPane.kind === 'links' ? (
                      <LinksScreen category={openInPane.category} inPane />
                    ) : openInPane.route === 'Photos' ? (
                      <PhotosScreen inPane />
                    ) : openInPane.route === 'Files' ? (
                      <FilesScreen inPane />
                    ) : openInPane.route === 'Stickers' ? (
                      <StickersScreen inPane />
                    ) : openInPane.route === 'Tags' ? (
                      <TagManageScreen inPane />
                    ) : openInPane.route === 'Groups' ? (
                      <GroupsScreen inPane />
                    ) : openInPane.route === 'Diary' ? (
                      <DiaryScreen inPane />
                    ) : (
                      <TasksScreen />
                    )}
                  </NavigationContext.Provider>
                </GlassTargetProvider>
              </GlassPortalHost>
            ) : (
              // Only ever seen for the instant between one pane closing and
              // the row unmounting - with nothing open the row is not drawn
              // at all now.
              <View style={styles.menuPaneEmpty}>
                <Ionicons name="apps-outline" size={26} color={GLASS_TEXT_FAINT} />
                <Text style={styles.menuPaneHint}>
                  Торкнись плитки, щоб відкрити базу тут. Затисни - щоб налаштувати плитку.
                </Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        <ContentColumn>
          {/* No title: the capsule says where this is, and the name cost
              the board a screenful. The tiles run all the way up and
              scroll off the top edge, the way the cards do everywhere
              else. */}
          {boardScroll}
        </ContentColumn>
      )}

      {/* The way out of arranging - and the only thing on screen that
          says the board is in it. */}
      {editing && (
        <View
          style={[
            styles.editBar,
            // Clear of the island lying across the foot of the screen -
            // its own height plus the gap it keeps from the edge.
            { bottom: databasesInsets.bottom + NAV_BOTTOM + RAIL_WIDTH + 16 },
          ]}
        >
        {/* A new section: a named band across the board. */}
        <Pressable style={styles.doneButton} onPress={() => setDividerPrompt({ mode: 'new' })}>
          <Ionicons name="remove-outline" size={18} color="#171310" />
          <Text style={styles.doneLabel}>Розділювач</Text>
        </Pressable>
        <Pressable
          style={styles.doneButton}
          onPress={() => {
            setEditing(false);
            // The settings pane belongs to arranging: leaving that mode
            // leaves it. On a wide screen it was opened by the same hold
            // that started the arranging, and it stayed behind after
            // "Готово" with nothing left to settle.
            setColorMenuKey(null);
          }}
        >
          <Ionicons name="checkmark" size={18} color="#171310" />
          <Text style={styles.doneLabel}>Готово</Text>
        </Pressable>
        </View>
      )}

      <ImportTableSheet
        visible={importing}
        otherDatabases={customDatabases.map((d) => ({ id: d.id, name: d.name }))}
        onClose={() => setImporting(false)}
        onDone={(databaseId, rowCount) => {
          setImporting(false);
          notify('Імпортовано', `Додано записів: ${rowCount}`);
          navigation.navigate('CustomDatabase', { databaseId });
        }}
      />

      <RenamePrompt
        // Remounted per opening: the prompt seeds its field once.
        key={dividerPrompt ? (dividerPrompt.mode === 'rename' ? dividerPrompt.id : 'new') : 'closed'}
        visible={dividerPrompt !== null}
        title={dividerPrompt?.mode === 'rename' ? 'Назва секції' : 'Новий розділювач'}
        initialValue={dividerPrompt?.mode === 'rename' ? viewData.dividers?.[dividerPrompt.id]?.label ?? '' : ''}
        placeholder="Назва секції"
        onCancel={() => setDividerPrompt(null)}
        onSave={saveDividerName}
      />

      <RenamePrompt
        visible={creatingDatabase}
        title="Нова база"
        initialValue=""
        placeholder="Назва бази"
        onCancel={() => setCreatingDatabase(false)}
        onSave={createDatabase}
      />

      {/* On a phone it is still a window: there is no room for a
          second column. */}
      {!isTwoPane && (
        <Modal visible={colorMenuKey !== null} transparent animationType="fade" onRequestClose={() => setColorMenuKey(null)}>
          <Pressable style={styles.colorMenuBackdrop} onPress={() => setColorMenuKey(null)}>
            <Pressable style={styles.colorMenuCard} onPress={(e) => e.stopPropagation()}>
              {tileMenu}
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* What else can go on the board: the groups (a theme of the
          period) and the smart folders (a saved filter). Both already
          know their own colour and how many they hold. */}
      <Modal
        visible={pinSheetVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPinSheetVisible(false)}
      >
        <Pressable style={styles.colorMenuBackdrop} onPress={() => setPinSheetVisible(false)}>
          <Pressable style={styles.pinCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.colorMenuTitle}>Закріпити на дошці</Text>
            <ScrollView style={styles.pinList}>
              <Text style={styles.pinSection}>Групи</Text>
              {pinnableGroups.length === 0 && <Text style={styles.pinEmpty}>Груп поки немає</Text>}
              {pinnableGroups.map((group) => {
                const key = groupKey(group.id);
                const on = pinnedKeys.includes(key);
                return (
                  <Pressable key={key} style={styles.sheetRow} onPress={() => togglePin(key)}>
                    <Ionicons name="albums-outline" size={17} color={group.color} />
                    <Text style={styles.sheetRowLabel} numberOfLines={1}>
                      {group.name}
                    </Text>
                    <Text style={styles.pinCount}>{group.count}</Text>
                    {on && <Ionicons name="checkmark" size={18} color={ACCENT} />}
                  </Pressable>
                );
              })}

              <Text style={styles.pinSection}>Смартпапки</Text>
              {pinnableTags.length === 0 && <Text style={styles.pinEmpty}>Смартпапок поки немає</Text>}
              {pinnableTags.map((tag) => {
                const key = tagKey(tag.id);
                const on = pinnedKeys.includes(key);
                return (
                  <Pressable key={key} style={styles.sheetRow} onPress={() => togglePin(key)}>
                    <Ionicons
                      name={tag.icon as keyof typeof Ionicons.glyphMap}
                      size={17}
                      color={tag.color}
                    />
                    <Text style={styles.sheetRowLabel} numberOfLines={1}>
                      {tag.name}
                    </Text>
                    <Text style={styles.pinCount}>{tag.count}</Text>
                    {on && <Ionicons name="checkmark" size={18} color={ACCENT} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <ImageCropper
        visible={cropping !== null}
        uri={cropping}
        aspect={backgroundFor?.aspect ?? 1}
        onCancel={() => {
          setCropping(null);
          setBackgroundFor(null);
        }}
        onDone={saveBackground}
      />

      {/* A picture picked from the search sheet is cropped exactly like a
          gallery one - same shape, same toning, same result. */}
      <ImageCropper
        visible={searchedCropping !== null}
        uri={searchedCropping}
        aspect={searchingFor?.aspect ?? 1}
        onCancel={() => {
          setSearchedCropping(null);
          setSearchingFor(null);
        }}
        onDone={(uri) => {
          if (searchingFor) setStyling({ key: searchingFor.key, uri, color: resolveTileColor(searchingFor.key) });
          setSearchedCropping(null);
          setSearchingFor(null);
        }}
      />

      <StockPhotoPicker
        visible={searchingFor !== null && searchedCropping === null}
        onClose={() => setSearchingFor(null)}
        onPicked={(uri) => setSearchedCropping(uri)}
      />

      <BackgroundStylist
        request={styling ? { uri: styling.uri, color: styling.color } : null}
        onDone={(uri) => {
          if (styling) setDoc(tileBackgroundsDoc, { [styling.key]: uri }, { merge: true });
          setStyling(null);
        }}
        onError={(message) => {
          notify('Не вдалося стилізувати фон', message);
          setStyling(null);
        }}
      />
    </View>
  );
}

// One tile. It knows nothing about the board it sits on: where it is and
// how big it is are given to it, and the corner grip hands back the size
// the finger is asking for, in whole cells.
// A named band across the board, between two rows. Held down while the
// board is being arranged, it lifts and follows the finger to another
// row, the way a tile does; tapped, it is renamed or removed.
function BoardDivider({
  label,
  top,
  height,
  editing,
  carried,
  onEdit,
  onCarryStart,
  onCarryMove,
  onCarryEnd,
}: {
  label: string;
  top: number;
  height: number;
  editing: boolean;
  carried: boolean;
  onEdit: () => void;
  onCarryStart: () => void;
  onCarryMove: (dy: number) => void;
  onCarryEnd: () => void;
}) {
  const carry = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(220)
    .enabled(editing)
    .onStart(() => onCarryStart())
    .onUpdate((e) => onCarryMove(e.translationY))
    .onFinalize(() => onCarryEnd());
  return (
    <Animated.View
      layout={carried ? undefined : LinearTransition.duration(220)}
      style={[styles.divider, { top, height }, carried && styles.dividerCarried]}
    >
      <GestureDetector gesture={carry}>
        <Pressable style={styles.dividerBody} onPress={editing ? onEdit : undefined} disabled={!editing}>
          <View style={styles.dividerLine} />
          {!!label && (
            <Text style={styles.dividerLabel} numberOfLines={1}>
              {label}
            </Text>
          )}
          <View style={styles.dividerLine} />
          {editing && <Ionicons name="reorder-two-outline" size={16} color={GLASS_TEXT_FAINT} />}
        </Pressable>
      </GestureDetector>
    </Animated.View>
  );
}

function BoardTile({
  item,
  left,
  top,
  width,
  height,
  color,
  background,
  count,
  latest,
  thumbs,
  size,
  cellSize,
  editing,
  onOpen,
  onHold,
  onColor,
  onResize,
  onResizeEnd,
  carried,
  onCarryStart,
  onCarryMove,
  onCarryEnd,
}: {
  item: BoardItem;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
  background?: string;
  // How many records this database holds, the newest one's own name, and
  // - for images - the newest few themselves.
  count?: number;
  latest?: string;
  thumbs?: string[];
  size: TileSize;
  cellSize: number;
  editing: boolean;
  onOpen: () => void;
  onHold: () => void;
  onColor: () => void;
  onResize: (size: TileSize) => void;
  onResizeEnd: (size: TileSize) => void;
  // Set while this tile is the one being carried: where it sits under the
  // finger, in the board's own coordinates.
  carried: { x: number; y: number } | null;
  onCarryStart: () => void;
  onCarryMove: (dx: number, dy: number) => void;
  onCarryEnd: () => void;
}) {
  const label =
    item.kind === 'builtin'
      ? item.tile.label
      : item.kind === 'custom'
        ? item.database.name
        : item.kind === 'pin'
          ? item.pin.name
          : item.key === NEW_TILE_KEY
            ? 'Нова база'
            : item.key === PIN_TILE_KEY
              ? 'Закріпити'
              : 'Імпорт таблиці';
  const icon: keyof typeof Ionicons.glyphMap =
    item.kind === 'builtin'
      ? item.tile.icon
      : item.kind === 'custom'
        ? (item.database.icon as keyof typeof Ionicons.glyphMap) ?? 'grid-outline'
        : item.kind === 'pin'
          ? (item.pin.icon as keyof typeof Ionicons.glyphMap)
          : item.key === NEW_TILE_KEY
            ? 'add'
            : item.key === PIN_TILE_KEY
              ? 'bookmark-outline'
              : 'download-outline';
  const isAction = item.kind === 'action';
  // A one-cell tile has room for the icon and nothing else.
  const tiny = size.w === 1 && size.h === 1;
  const showThumbs = !!thumbs?.length && size.w >= 2 && size.h >= 2;
  const showLatest = !!latest && !isAction && size.w >= 2 && (size.h >= 2 || size.w >= 3);
  const showCount = count !== undefined && !isAction;

  // The tile is PAINTED in its colour now, rather than being glass with a
  // coloured icon on it - so the ink has to answer to the paint. Same
  // rule and the same function the note cards have always used: near-black
  // on a light fill, white on a dark one.
  //
  // Two exceptions, both still glass. The action tiles ("Нова база" and
  // its neighbours) are not databases and have no colour of their own; and
  // a tile carrying a background picture keeps its scrim and white text,
  // because what is behind the ink there is the picture, not the colour.
  const painted = !isAction && !background;
  const ink = painted ? contrastTextColor(color) : '#fff';
  const inkMuted = !painted
    ? 'rgba(255,255,255,0.55)'
    : ink === '#FFFFFF'
      ? 'rgba(255,255,255,0.75)'
      : 'rgba(17,24,39,0.65)';

  // The grip: dragged, it turns the distance travelled into whole cells
  // and snaps to the nearest size the board allows, live, so the board
  // re-packs under the finger rather than after it.
  // The size the tile had when the finger went down. It has to be
  // remembered, not read: the tile resizes live under the drag, so
  // measuring from its CURRENT width adds the growth to the finger's own
  // travel and the size runs away - one cell wider becomes two, and three
  // across could never be landed on at all.
  const dragBase = useRef({ width, height });
  const sizeFromDrag = (dx: number, dy: number) => {
    const cells = Math.max(1, cellSize);
    const w = Math.max(1, Math.round((dragBase.current.width + dx) / cells));
    const h = Math.max(1, Math.round((dragBase.current.height + dy) / cells));
    // The two tiles that make new databases keep their label: they never
    // shrink to the icon-only cell.
    return snapTileSize(w, h, isAction ? 2 : 1);
  };
  const grip = Gesture.Pan()
    .runOnJS(true)
    // Claims the drag on the first pixel in any direction: this is a
    // corner grip, the only thing it can mean is a resize.
    .minDistance(0)
    .onBegin(() => {
      dragBase.current = { width, height };
    })
    .onUpdate((e) => onResize(sizeFromDrag(e.translationX, e.translationY)))
    .onEnd((e) => onResizeEnd(sizeFromDrag(e.translationX, e.translationY)));

  // Carrying a tile: held down on the board that is already being
  // arranged, it lifts off and follows the finger while the others pack
  // themselves around where it would land. A long press to start, so the
  // board can still be scrolled with a plain drag.
  const carry = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(220)
    .enabled(editing)
    .onStart(() => onCarryStart())
    .onUpdate((e) => onCarryMove(e.translationX, e.translationY))
    // Only onFinalize, not onEnd as well: a cancelled carry (a call
    // coming in, the finger leaving the screen) has to put the tile down
    // too, and calling both would save the same order twice.
    .onFinalize(() => onCarryEnd());

  return (
    <Animated.View
      // A carried tile is not animated into place - it is under a finger,
      // and a layout animation would chase it a beat behind.
      layout={carried ? undefined : LinearTransition.duration(220)}
      style={[
        styles.tile,
        painted && { backgroundColor: color, borderColor: 'rgba(255,255,255,0.18)' },
        isAction && styles.newTile,
        { left, top, width, height },
        carried && { left: carried.x, top: carried.y, zIndex: 20, opacity: 0.95, transform: [{ scale: 1.04 }] },
      ]}
    >
      {/* Behind everything, already the tile's own shape (see
          ImageCropper) - so it fills the tile exactly, with nothing to
          re-fit on each render. A scrim keeps the label readable over a
          bright picture. */}
      {background && (
        <>
          <Image source={{ uri: background }} style={styles.tileImage} resizeMode="cover" resizeMethod="resize" />
          <View style={styles.tileScrim} pointerEvents="none" />
        </>
      )}

      <GestureDetector gesture={carry}>
      <Pressable
        style={styles.tileTap}
        onPress={editing ? onColor : onOpen}
        onLongPress={onHold}
        delayLongPress={400}
      >
        {/* The newest few images instead of an icon, once there is room
            for them to be seen rather than guessed at. */}
        {showThumbs ? (
          <View style={styles.thumbRow}>
            {thumbs!.slice(0, size.w >= 3 ? 4 : 2).map((uri) => (
              <Image key={uri} source={{ uri }} style={styles.thumb} resizeMode="cover" resizeMethod="resize" />
            ))}
          </View>
        ) : (
          <Ionicons name={icon} size={tiny ? 24 : 22} color={isAction ? 'rgba(255,255,255,0.6)' : ink} />
        )}
        {!tiny && (
          <Text
            style={[styles.tileLabel, { color: isAction ? 'rgba(255,255,255,0.6)' : ink }]}
            numberOfLines={2}
          >
            {label}
          </Text>
        )}
        {/* The newest record's own name - only where the tile is tall
            enough that it is a line of its own rather than a crush. */}
        {showLatest && (
          <Text style={[styles.tileLatest, { color: inkMuted }]} numberOfLines={size.h > 1 ? 2 : 1}>
            {latest}
          </Text>
        )}
      </Pressable>
      </GestureDetector>

      {/* How many are in there. Top corner, out of the label's way, and
          gone while the board is being arranged so it cannot be mistaken
          for a control. */}
      {showCount && !editing && (
        <Text style={[styles.tileCount, { color: ink }]}>{count}</Text>
      )}

      {editing && (
        <GestureDetector gesture={grip}>
          {/* Sized to the tile: at one cell the standing grip covered a
              quarter of it. */}
          <View style={[styles.grip, tiny && styles.gripSmall]}>
            <Ionicons name="resize-outline" size={tiny ? 11 : 14} color="rgba(255,255,255,0.75)" />
          </View>
        </GestureDetector>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  railWrap: {
    position: 'absolute',
    right: RAIL_RIGHT,
    alignItems: 'center',
  },
  // Stood on its end, like every other screen's.
  headerButtons: {
    alignItems: 'center',
    gap: 18,
    paddingVertical: 18,
    paddingHorizontal: 19,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  // Turned with the capsule.
  headerButtonsDivider: {
    width: 20,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  content: {
    // Full width: the tiles pass UNDER the rail, and the glass over them
    // is the point of it.
    paddingHorizontal: 20,
    // Clears FloatingIslandTabBar (bottom: 24, ~64 tall) so the last tile
    // can be scrolled out from under it - same 120 DocumentsScreen's own
    // list already uses.
    paddingBottom: 120,
  },
  // White capsule tiles felt right on a plain page; on the gradient the
  // same glass surfaces as the rest of this redesign hold together better
  // than a solid white card would.
  board: {
    width: '100%',
    position: 'relative',
  },
  boardRule: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  tile: {
    position: 'absolute',
    backgroundColor: 'rgba(20,20,20,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 16,
    overflow: 'hidden',
  },
  tileImage: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  tileScrim: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  tileTap: {
    flex: 1,
    padding: 12,
    gap: 8,
    justifyContent: 'flex-end',
  },
  // Bottom-right, where a window is resized from.
  grip: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  gripSmall: {
    width: 22,
    height: 22,
    borderTopLeftRadius: 8,
  },
  pinCard: {
    backgroundColor: GLASS_BODY,
    borderRadius: 18,
    padding: 16,
    width: '100%',
    maxWidth: 420,
    maxHeight: '70%',
  },
  pinList: {
    marginTop: 8,
  },
  pinSection: {
    fontSize: 11,
    fontFamily: FONT_MEDIUM,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.06,
    marginTop: 12,
    marginBottom: 2,
  },
  pinEmpty: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.4)',
    paddingVertical: 8,
  },
  pinCount: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.5)',
  },
  sheetRule: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 6,
  },
  editBar: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  divider: {
    position: 'absolute',
    left: 0,
    right: 0,
    justifyContent: 'center',
  },
  dividerCarried: {
    zIndex: 20,
    opacity: 0.95,
  },
  dividerBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  dividerLabel: {
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: FONT_MEDIUM,
    color: GLASS_TEXT_FAINT,
    maxWidth: '60%',
  },
  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  doneLabel: {
    fontSize: 14,
    fontFamily: FONT_MEDIUM,
    color: '#171310',
  },
  tileCount: {
    position: 'absolute',
    top: 10,
    right: 12,
    fontSize: 13,
    fontFamily: FONT_MEDIUM,
    opacity: 0.75,
  },
  tileLatest: {
    fontSize: 11,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.55)',
  },
  thumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  thumb: {
    width: 34,
    height: 34,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  tileLabel: {
    fontSize: 15,
    fontWeight: '500',
    fontFamily: FONT_MEDIUM,
  },
  newTile: {
    borderStyle: 'dashed',
  },
  // Two halves of one screen, not a window over it. Reversed so the
  // board keeps the right side, against the rail that belongs to it -
  // the same arrangement the documents list uses.
  paneRow: {
    flex: 1,
    flexDirection: 'row-reverse',
  },
  boardPane: {
    flex: 1,
  },
  // The tile's settings: a small card, centred in the pane with room
  // around it.
  menuPane: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: GLASS_LINE,
    padding: 16,
    justifyContent: 'center',
  },
  // A whole database is not that card. It takes the pane entire - no
  // padding, and no centring: a screen given "justifyContent: center"
  // is not stretched at all, it is sized by its own content and stood
  // in the middle, which is what left the cards a narrow tall strip
  // pressed against one side. It measures the pane it is given, so
  // the pane has to be the pane.
  databasePane: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: GLASS_LINE,
  },
  menuPaneCard: {
    gap: 10,
  },
  menuPaneEmpty: {
    alignItems: 'center',
    gap: 10,
    opacity: 0.7,
  },
  menuPaneHint: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_FAINT,
    textAlign: 'center',
  },
  colorMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  colorMenuCard: {
    backgroundColor: GLASS_BODY,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 320,
  },
  colorMenuTitle: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
    marginBottom: 14,
  },
  colorMenuRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  sheetRowLabel: {
    fontSize: 14,
    fontFamily: FONT_MEDIUM,
    color: GLASS_TEXT,
  },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
});
