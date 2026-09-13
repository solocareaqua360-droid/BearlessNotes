import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, doc, onSnapshot } from '@react-native-firebase/firestore';
import { addDoc, setDoc } from '../utils/owned';
import {
  GRID_TILES,
  Tile,
  WIDE_TILES,
  openDatabaseTile,
  tileColorsDoc,
} from '../constants/databaseTiles';
import { useDatabaseTiles } from '../hooks/useDatabaseTiles';
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
import { db } from '../firebase';
import { RootStackParamList } from '../navigation';
import { TAG_COLORS } from '../constants/tags';
import { FONT_REGULAR, FONT_MEDIUM, FONT_BOLD } from '../utils/fonts';
import { colorForDocument } from '../utils/documentColor';
import RenamePrompt from '../components/RenamePrompt';
import ImportTableSheet from '../components/ImportTableSheet';
import ContentColumn from '../components/ContentColumn';
import { GLASS_BODY, GLASS_TEXT } from '../constants/glass';
import { BlurView } from 'expo-blur';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassPortal } from '../components/GlassPortal';
import { useBlurTarget } from '../components/GlassTarget';
import { GLASS_ISLAND } from '../constants/glass';
import { CAPSULE_DROP, CHROME_TOP, RAIL_CLEARANCE, RAIL_RIGHT } from '../constants/rail';

const NEW_TILE_KEY = '__new__';
const IMPORT_TILE_KEY = '__import__';
const TILE_GAP = 10;
// The gap the tiles hold while they are being arranged - they draw apart
// to make room for the grips, and close back up when the board is done.
const TILE_GAP_EDITING = 16;
const tileSizesDoc = doc(db, 'settings', 'databaseTileSizes');

type BoardItem =
  | { key: string; kind: 'builtin'; tile: Tile }
  | { key: string; kind: 'custom'; database: CustomDatabase }
  | { key: string; kind: 'action' };

// What a tile is before anyone resizes it: documents lead the board, the
// tasks run across under them, every database is a square, and the two
// tiles that make new ones are as small as a tile gets.
function defaultSizeFor(key: string): TileSize {
  if (key === 'documents') return { w: 4, h: 2 };
  if (key === 'tasks') return { w: 4, h: 1 };
  if (key === NEW_TILE_KEY || key === IMPORT_TILE_KEY) return { w: 1, h: 1 };
  return DEFAULT_TILE_SIZE;
}

export default function DatabasesScreen() {
  const databasesBlurTarget = useBlurTarget();
  const databasesFocused = useIsFocused();
  const databasesInsets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { colorFor, customDatabases } = useDatabaseTiles();
  const [colorMenuKey, setColorMenuKey] = useState<string | null>(null);
  const [tileSizes, setTileSizes] = useState<Record<string, string>>({});
  // Held-down, the board goes into its arranging state: the tiles draw
  // apart to make room for the grips, and nothing opens on a tap.
  const [editing, setEditing] = useState(false);
  const [boardWidth, setBoardWidth] = useState(0);
  // The size being dragged right now, so the board can re-pack around it
  // before the drag ends and it is written down.
  const [draftSize, setDraftSize] = useState<{ key: string; size: TileSize } | null>(null);

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
  const boardItems: BoardItem[] = [
    ...WIDE_TILES.map((tile) => ({ key: tile.key, kind: 'builtin' as const, tile })),
    ...GRID_TILES.map((tile) => ({ key: tile.key, kind: 'builtin' as const, tile })),
    ...customDatabases.map((database) => ({ key: database.id, kind: 'custom' as const, database })),
    { key: NEW_TILE_KEY, kind: 'action' as const },
    { key: IMPORT_TILE_KEY, kind: 'action' as const },
  ];
  const firstOwnKey = customDatabases[0]?.id ?? NEW_TILE_KEY;
  const { placed, rows } = packTiles(
    boardItems,
    (item) => sizeFor(item.key),
    // Everything above the rule is built in; the user's own starts on a
    // fresh row under it.
    (item) => item.key === firstOwnKey
  );
  const ruleRow = placed.find((p) => p.item.key === firstOwnKey)?.y ?? 0;

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
        <View style={styles.headerRow}>
          <Text style={styles.header}>Бази даних</Text>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
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
            {ruleRow > 0 && (
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
                      : colorFor(item.key)
                  }
                  editing={editing}
                  cellSize={cellSize}
                  size={size}
                  onOpen={() => {
                    if (item.kind === 'builtin') openTile(item.tile);
                    else if (item.kind === 'custom')
                      navigation.navigate('CustomDatabase', { databaseId: item.database.id });
                    else if (item.key === NEW_TILE_KEY) setCreatingDatabase(true);
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
                />
              ))}
          </View>
        </ScrollView>

        {/* The way out of arranging - and the only thing on screen that
            says the board is in it. */}
        {editing && (
          <Pressable style={styles.doneButton} onPress={() => setEditing(false)}>
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
            Alert.alert('Імпортовано', `Додано записів: ${rowCount}`);
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
              <Text style={styles.colorMenuTitle}>Колір плитки</Text>
              <View style={styles.colorMenuRow}>
                {TAG_COLORS.map((color) => (
                  <Pressable key={color} onPress={() => colorMenuKey && pickColor(colorMenuKey, color)}>
                    <View style={[styles.colorSwatch, { backgroundColor: color }]} />
                  </Pressable>
                ))}
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </ContentColumn>

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
  size,
  cellSize,
  editing,
  onOpen,
  onHold,
  onColor,
  onResize,
  onResizeEnd,
}: {
  item: BoardItem;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
  size: TileSize;
  cellSize: number;
  editing: boolean;
  onOpen: () => void;
  onHold: () => void;
  onColor: () => void;
  onResize: (size: TileSize) => void;
  onResizeEnd: (size: TileSize) => void;
}) {
  const label =
    item.kind === 'builtin'
      ? item.tile.label
      : item.kind === 'custom'
        ? item.database.name
        : item.key === NEW_TILE_KEY
          ? 'Нова база'
          : 'Імпорт таблиці';
  const icon: keyof typeof Ionicons.glyphMap =
    item.kind === 'builtin'
      ? item.tile.icon
      : item.kind === 'custom'
        ? (item.database.icon as keyof typeof Ionicons.glyphMap) ?? 'grid-outline'
        : item.key === NEW_TILE_KEY
          ? 'add'
          : 'download-outline';
  const isAction = item.kind === 'action';
  // A one-cell tile has room for the icon and nothing else.
  const tiny = size.w === 1 && size.h === 1;

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
    return snapTileSize(w, h);
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

  return (
    <Animated.View
      layout={LinearTransition.duration(220)}
      style={[styles.tile, isAction && styles.newTile, { left, top, width, height }]}
    >
      <Pressable
        style={styles.tileTap}
        onPress={editing ? onColor : onOpen}
        onLongPress={onHold}
        delayLongPress={400}
      >
        <Ionicons name={icon} size={tiny ? 24 : 22} color={isAction ? 'rgba(255,255,255,0.6)' : color} />
        {!tiny && (
          <Text
            style={[styles.tileLabel, { color: isAction ? 'rgba(255,255,255,0.6)' : color }]}
            numberOfLines={2}
          >
            {label}
          </Text>
        )}
      </Pressable>

      {editing && (
        <GestureDetector gesture={grip}>
          <View style={styles.grip}>
            <Ionicons name="resize-outline" size={14} color="rgba(255,255,255,0.75)" />
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: RAIL_CLEARANCE,
    // Same level as DocumentsScreen's title.
    paddingTop: 90,
    paddingBottom: 12,
  },
  header: {
    // At least 2x the previous 22.
    fontSize: 46,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#fff',
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
  doneButton: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 40,
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
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
});
