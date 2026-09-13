import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, deleteField, doc, onSnapshot } from '@react-native-firebase/firestore';
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
  TILE_COLUMNS,
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
import { colorForDocument } from '../utils/documentColor';
import RenamePrompt from '../components/RenamePrompt';
import { ask, confirm, notify } from '../components/surfaces/Ask';
import ImportTableSheet from '../components/ImportTableSheet';
import ContentColumn from '../components/ContentColumn';
import { GLASS_BODY, GLASS_DANGER, GLASS_TEXT } from '../constants/glass';
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

export default function DatabasesScreen() {
  const databasesBlurTarget = useBlurTarget();
  const databasesFocused = useIsFocused();
  const databasesInsets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { colorFor, customDatabases } = useDatabaseTiles();
  // What is inside each database, for the tiles to show - see
  // useDatabaseContents.
  const { counts, latest, photoThumbs, pinnableGroups, pinnableTags } = useDatabaseContents();
  const [colorMenuKey, setColorMenuKey] = useState<string | null>(null);
  const [tileSizes, setTileSizes] = useState<Record<string, string>>({});
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
  // the order the board is packing itself into while it is held there.
  const [drag, setDrag] = useState<{ key: string; x: number; y: number } | null>(null);
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null);
  // The order the board was in when the carry began - what every drop is
  // measured against, so the target cannot drift under the finger.
  const dragBaseOrder = useRef<string[] | null>(null);
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
    setDoc(tileSizesDoc, { [key]: deleteField() }, { merge: true });
    setColorMenuKey(null);
  }

  function resetBoard() {
    confirm({
      title: 'Скинути дошку?',
      message: 'Розміри й порядок плиток повернуться до стандартних. Кольори й фони лишаться.',
      confirmLabel: 'Скинути',
    }).then((yes) => {
      if (!yes) return;
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
    return parseTileSize(tileSizes[key]) ?? defaultSizeFor(key);
  }

  function setSize(key: string, size: TileSize) {
    setDoc(tileSizesDoc, { [key]: formatTileSize(size) }, { merge: true });
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
  const activeOrder = draftOrder ?? order;
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
  const showRule = !activeOrder;
  const firstOwnKey = customDatabases[0]?.id ?? NEW_TILE_KEY;
  const { placed, rows } = packTiles(
    orderedItems,
    (item) => sizeFor(item.key),
    (item) => showRule && item.key === firstOwnKey
  );
  const ruleRow = showRule ? placed.find((p) => p.item.key === firstOwnKey)?.y ?? 0 : 0;

  // Where a carried tile would land.
  //
  // Measured against the board WITHOUT the carried tile, packed from the
  // order the drag started in - a fixed picture that does not move while
  // the finger does. The first version compared against the live board
  // instead, which was being re-packed by this very function on every
  // move: the tile it was aiming at kept sliding away under it, and when
  // nothing matched the answer was "last", which is how a tile halfway up
  // the board could suddenly be flung to the end.
  function orderWithDrop(key: string, x: number, y: number): string[] {
    const base = dragBaseOrder.current ?? orderedItems.map((item) => item.key);
    const without = base.filter((k) => k !== key);
    if (cellStep <= 0) return base;
    const others = without
      .map((k) => boardItems.find((item) => item.key === k))
      .filter((item): item is BoardItem => !!item);
    const { placed: stable } = packTiles(others, (item) => sizeFor(item.key));
    // Both the finger and every tile become one number along the board's
    // reading order, so the comparison is a single "before or after" and
    // moves with the finger instead of jumping.
    const col = Math.max(0, Math.min(TILE_COLUMNS - 1, Math.round(x / cellStep)));
    const row = Math.max(0, Math.round(y / cellStep));
    const fingerAt = row * TILE_COLUMNS + col;
    let index = stable.findIndex(
      (p) => (p.y + p.size.h / 2) * TILE_COLUMNS + (p.x + p.size.w / 2) > fingerAt
    );
    if (index < 0) index = without.length;
    const next = [...without];
    next.splice(index, 0, key);
    return next;
  }

  // A cell is square, and the board is as wide as the column it sits in.
  // While arranging, the gap grows: the tiles draw apart to make room for
  // the grips, and close back up into a dense board when it is done.
  const gap = editing ? TILE_GAP_EDITING : TILE_GAP;
  const cellSize = boardWidth > 0 ? (boardWidth - gap * (TILE_COLUMNS - 1)) / TILE_COLUMNS : 0;
  const cellStep = cellSize + gap;
  const spanSize = (cells: number) => cells * cellSize + (cells - 1) * gap;

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

      <ContentColumn>
        {/* No title: the capsule says where this is, and the name cost
            the board a screenful. The tiles run all the way up and scroll
            off the top edge, the way the cards do everywhere else. */}
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
            style={[styles.board, { height: Math.max(0, rows * cellStep - gap) }]}
            onLayout={(e) => setBoardWidth(e.nativeEvent.layout.width)}
          >
            {/* Everything above is built in; everything below is yours. */}
            {showRule && ruleRow > 0 && (
              <View style={[styles.boardRule, { top: ruleRow * cellStep - gap / 2 }]} />
            )}

            {cellSize > 0 &&
              placed.map(({ item, x, y, size }) => (
                <BoardTile
                  key={item.key}
                  item={item}
                  left={x * cellStep}
                  top={y * cellStep}
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
                  }}
                  onColor={() => setColorMenuKey(item.key)}
                  onResize={(next) => setDraftSize({ key: item.key, size: next })}
                  onResizeEnd={(next) => {
                    setDraftSize(null);
                    setSize(item.key, next);
                  }}
                  carried={drag?.key === item.key ? { x: drag.x, y: drag.y } : null}
                  onCarryStart={() => {
                    hapticButtonDown();
                    dragBaseOrder.current = orderedItems.map((i) => i.key);
                    setDrag({ key: item.key, x: x * cellStep, y: y * cellStep });
                    setDraftOrder(dragBaseOrder.current);
                  }}
                  onCarryMove={(dx, dy) => {
                    const nextX = x * cellStep + dx;
                    const nextY = y * cellStep + dy;
                    setDrag({ key: item.key, x: nextX, y: nextY });
                    setDraftOrder(orderWithDrop(item.key, nextX, nextY));
                  }}
                  onCarryEnd={() => {
                    const next = draftOrder;
                    dragBaseOrder.current = null;
                    setDrag(null);
                    setDraftOrder(null);
                    if (next) setDoc(tileOrderDoc, { order: next }, { merge: true });
                  }}
                />
              ))}
          </View>
        </ScrollView>

        {/* The way out of arranging - and the only thing on screen that
            says the board is in it. */}
        {editing && (
          <Pressable
            style={[
              styles.doneButton,
              // Clear of the island lying across the foot of the screen -
              // its own height plus the gap it keeps from the edge.
              { bottom: databasesInsets.bottom + NAV_BOTTOM + RAIL_WIDTH + 16 },
            ]}
            onPress={() => setEditing(false)}
          >
            <Ionicons name="checkmark" size={18} color="#171310" />
            <Text style={styles.doneLabel}>Готово</Text>
          </Pressable>
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
          visible={creatingDatabase}
          title="Нова база"
          initialValue=""
          placeholder="Назва бази"
          onCancel={() => setCreatingDatabase(false)}
          onSave={createDatabase}
        />

        {/* Color picker - only the harmonious palette is offered. */}
        <Modal visible={colorMenuKey !== null} transparent animationType="fade" onRequestClose={() => setColorMenuKey(null)}>
          <Pressable style={styles.colorMenuBackdrop} onPress={() => setColorMenuKey(null)}>
            <Pressable style={styles.colorMenuCard} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.colorMenuTitle}>Плитка</Text>
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
            </Pressable>
          </Pressable>
        </Modal>
      </ContentColumn>

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
          <Image source={{ uri: background }} style={styles.tileImage} resizeMode="cover" />
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
              <Image key={uri} source={{ uri }} style={styles.thumb} resizeMode="cover" />
            ))}
          </View>
        ) : (
          <Ionicons name={icon} size={tiny ? 24 : 22} color={isAction ? 'rgba(255,255,255,0.6)' : color} />
        )}
        {!tiny && (
          <Text
            style={[styles.tileLabel, { color: isAction ? 'rgba(255,255,255,0.6)' : color }]}
            numberOfLines={2}
          >
            {label}
          </Text>
        )}
        {/* The newest record's own name - only where the tile is tall
            enough that it is a line of its own rather than a crush. */}
        {showLatest && (
          <Text style={styles.tileLatest} numberOfLines={size.h > 1 ? 2 : 1}>
            {latest}
          </Text>
        )}
      </Pressable>
      </GestureDetector>

      {/* How many are in there. Top corner, out of the label's way, and
          gone while the board is being arranged so it cannot be mistaken
          for a control. */}
      {showCount && !editing && (
        <Text style={[styles.tileCount, { color }]}>{count}</Text>
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
  doneButton: {
    position: 'absolute',
    alignSelf: 'center',
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
