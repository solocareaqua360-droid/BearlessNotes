import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { setDoc } from '../utils/owned';
import { useSoft } from '../theme/soft';
import { withAlpha } from '../utils/color';
import AttachmentImage from './AttachmentImage';
import { Ionicons } from './icons/Ionicons';
import { notify } from './surfaces/Ask';

// «ПОЛОТНО» FOR PHOTOS (the user's, 2026-10-02): a table the photos are
// poured out on, like a puzzle - "висипаємо на стіл, збираємо маленькі
// фрагменти щоб побачити загальну картину". The folder tree lies on the
// same table: what is not in any folder lies loose at the root, where it
// was put; a folder is a node, and opening it unfolds it in place into an
// island of what is already in it, to rethink and move elsewhere.
//
//  - a photo dragged onto a folder (its node, its island, or a sub-folder
//    line inside an island) MOVES there; dragged out onto the table, it
//    leaves its folder and stays where it was dropped;
//  - a folder node is dragged anywhere, tapped to open or close;
//  - one finger on the table moves it, two zoom it.
// Positions (the loose photos', the nodes') and which folders are open are
// kept in settings/photoCanvas, so the table is the same on both devices.
//
// A folder - a node, or a sub-folder's line in an island - is carried the
// same way: onto another folder it goes inside it, onto the table it
// becomes a top-level folder where it was let go.
//
// Still to come: "Додати в іншу" (pale copies), piles, the rectangle
// selection, a new folder.

export type CanvasPhoto = { id: string; imageUri: string; driveFileId?: string; title?: string };

type Pos = { x: number; y: number };
type Layout = { photos: Record<string, Pos>; folders: Record<string, Pos>; open: Record<string, boolean> };
const EMPTY_LAYOUT: Layout = { photos: {}, folders: {}, open: {} };

// The world: a square this big around the origin, so everything on it
// stays inside its parent's bounds - on Android a child outside them is
// drawn but never touched (see the android overlay touch memory).
const WORLD_HALF = 4000;
const TILE = 88;
const GAP = 10;
const NODE_W = 160;
const NODE_H = 48;
const ISLAND_PAD = 10;
// An island's columns: two on a phone's narrow screen, three where there
// is room.
const islandColsFor = (screenW: number) => (screenW < 600 ? 2 : 3);
const CHIP_H = 36;
const ROOT_COLS = 3;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;
// How far a dragged thing travels before the target under it is asked
// again - often enough to light up a folder in time, rarely enough not to
// cross to JS every frame.
const HOVER_STEP = 10;

const canvasDoc = doc(db, 'settings', 'photoCanvas');
const nameOf = (path: string) => path.split('/').pop() ?? path;
const depthOf = (path: string) => path.split('/').length;

type Island = {
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tiles: { photo: CanvasPhoto; x: number; y: number }[];
  chips: { path: string; x: number; y: number; w: number; count: number; open: boolean }[];
};

export default function PhotoCanvas({
  photos,
  folderPaths,
  folderOf,
  onMove,
  onMoveFolder,
  onOpenPhoto,
  onPhotoMenu,
  topPad,
}: {
  photos: CanvasPhoto[];
  folderPaths: string[];
  folderOf: (photo: CanvasPhoto) => string | null;
  onMove: (photo: CanvasPhoto, folder: string | null) => Promise<void>;
  // A folder put into another (or, null, out to the top level).
  onMoveFolder: (path: string, parent: string | null) => Promise<void>;
  onOpenPhoto: (photo: CanvasPhoto) => void;
  onPhotoMenu: (photo: CanvasPhoto) => void;
  topPad: number;
}) {
  const S = useSoft();
  const { width: screenW } = useWindowDimensions();
  const [layout, setLayout] = useState<Layout>(EMPTY_LAYOUT);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        canvasDoc,
        (snap: { data: () => Partial<Layout> | undefined }) => {
          const data = snap.data();
          setLayout({ photos: data?.photos ?? {}, folders: data?.folders ?? {}, open: data?.open ?? {} });
        },
        () => {}
      ),
    []
  );
  const save = (patch: Partial<Layout>) => {
    setLayout((prev) => ({
      photos: { ...prev.photos, ...(patch.photos ?? {}) },
      folders: { ...prev.folders, ...(patch.folders ?? {}) },
      open: { ...prev.open, ...(patch.open ?? {}) },
    }));
    setDoc(canvasDoc, patch, { merge: true }).catch(() => {});
  };

  // ---- the table's own pan and zoom --------------------------------------
  // screen = (world + WORLD_HALF) * scale + translate
  const scale = useSharedValue(1);
  const tx = useSharedValue(-WORLD_HALF + 20);
  const ty = useSharedValue(-WORLD_HALF + topPad + 16);
  const start = useSharedValue({ tx: 0, ty: 0, scale: 1, fx: 0, fy: 0 });
  const canvasPan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .onStart(() => {
          start.value = { ...start.value, tx: tx.value, ty: ty.value };
        })
        .onUpdate((e) => {
          tx.value = start.value.tx + e.translationX;
          ty.value = start.value.ty + e.translationY;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onStart((e) => {
          start.value = { tx: tx.value, ty: ty.value, scale: scale.value, fx: e.focalX, fy: e.focalY };
        })
        .onUpdate((e) => {
          const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, start.value.scale * e.scale));
          // The point under the fingers stays under them.
          const ratio = next / start.value.scale;
          tx.value = e.focalX - (start.value.fx - start.value.tx) * ratio;
          ty.value = e.focalY - (start.value.fy - start.value.ty) * ratio;
          scale.value = next;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const tableGesture = useMemo(() => Gesture.Simultaneous(canvasPan, pinch), [canvasPan, pinch]);
  const surfaceStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  // ---- where everything stands -------------------------------------------
  const topFolders = folderPaths.filter((p) => depthOf(p) === 1).sort((a, b) => a.localeCompare(b));
  const childrenOf = (path: string) =>
    folderPaths.filter((p) => p.startsWith(`${path}/`) && depthOf(p) === depthOf(path) + 1).sort((a, b) => a.localeCompare(b));
  const inFolder = new Map<string, CanvasPhoto[]>();
  const loose: CanvasPhoto[] = [];
  photos.forEach((photo) => {
    const folder = folderOf(photo);
    if (folder === null) loose.push(photo);
    else inFolder.set(folder, [...(inFolder.get(folder) ?? []), photo]);
  });
  const countUnder = (path: string) => {
    let n = 0;
    inFolder.forEach((list, key) => {
      if (key === path || key.startsWith(`${path}/`)) n += list.length;
    });
    return n;
  };

  // An open folder's island, laid out from its top-left corner: its own
  // photos in a grid, then a line per sub-folder, each opening beneath
  // itself the same way.
  const ISLAND_COLS = islandColsFor(screenW);
  const islandW = ISLAND_COLS * TILE + (ISLAND_COLS - 1) * GAP + ISLAND_PAD * 2;
  const islands: Island[] = [];
  const layIsland = (path: string, x: number, y: number, w: number): number => {
    const own = inFolder.get(path) ?? [];
    const island: Island = { path, x, y, w, h: 0, tiles: [], chips: [] };
    islands.push(island);
    let cursor = y + ISLAND_PAD;
    own.forEach((photo, i) => {
      const col = i % ISLAND_COLS;
      const row = Math.floor(i / ISLAND_COLS);
      island.tiles.push({ photo, x: x + ISLAND_PAD + col * (TILE + GAP), y: cursor + row * (TILE + GAP) });
    });
    if (own.length) cursor += Math.ceil(own.length / ISLAND_COLS) * (TILE + GAP);
    childrenOf(path).forEach((child) => {
      const open = !!layout.open[child];
      island.chips.push({ path: child, x: x + ISLAND_PAD, y: cursor, w: w - ISLAND_PAD * 2, count: countUnder(child), open });
      cursor += CHIP_H + GAP;
      if (open) cursor = layIsland(child, x + ISLAND_PAD, cursor, w - ISLAND_PAD * 2) + GAP;
    });
    if (!own.length && !childrenOf(path).length) cursor += 24;
    island.h = cursor - y + ISLAND_PAD - GAP;
    return y + island.h;
  };

  // Folder nodes: where they were put, or - never moved yet - one under
  // another down the left edge, each making room for its own island.
  let columnY = 0;
  const nodes = topFolders.map((path) => {
    const saved = layout.folders[path];
    const x = saved?.x ?? 0;
    const y = saved?.y ?? columnY;
    const open = !!layout.open[path];
    const bottom = open ? layIsland(path, x, y + NODE_H + GAP, islandW) : y + NODE_H;
    if (!saved) columnY = bottom + 18;
    return { path, x, y, open, count: countUnder(path) };
  });

  // Loose photos: where they were dropped, or - never placed - a neat
  // grid beside the folders, the way a pile first lands on the table.
  // Clear of the folders' column AND of an island opening under them - an
  // open island is wider than its node, and laid over the pile it hid it.
  const looseX = topFolders.length ? Math.max(NODE_W, islandW) + 40 : 0;
  const looseCols = Math.max(2, Math.min(ROOT_COLS, Math.floor((screenW - looseX - 40) / (TILE + GAP))));
  let unplaced = 0;
  const looseTiles = loose.map((photo) => {
    const saved = layout.photos[photo.id];
    if (saved) return { photo, x: saved.x, y: saved.y };
    const i = unplaced++;
    return { photo, x: looseX + (i % looseCols) * (TILE + GAP), y: Math.floor(i / looseCols) * (TILE + GAP) };
  });

  // ---- what is under a point ------------------------------------------------
  // Smallest first: a sub-folder line inside an island beats the island.
  // `exclude`: a folder being carried - it is never its own target, nor is
  // anything inside it.
  const targetAt = (wx: number, wy: number, exclude: string | null = null): string | null => {
    const skip = (path: string) => exclude !== null && (path === exclude || path.startsWith(`${exclude}/`));
    for (const island of islands) {
      for (const chip of island.chips) {
        if (skip(chip.path)) continue;
        if (wx >= chip.x && wx <= chip.x + chip.w && wy >= chip.y && wy <= chip.y + CHIP_H) return chip.path;
      }
    }
    for (const node of nodes) {
      if (skip(node.path)) continue;
      if (wx >= node.x && wx <= node.x + NODE_W && wy >= node.y && wy <= node.y + NODE_H) return node.path;
    }
    // The deepest island the point is in.
    let best: Island | null = null;
    for (const island of islands) {
      if (skip(island.path)) continue;
      if (wx >= island.x && wx <= island.x + island.w && wy >= island.y && wy <= island.y + island.h) {
        if (!best || depthOf(island.path) > depthOf(best.path)) best = island;
      }
    }
    return best ? best.path : null;
  };
  const targetRef = useRef(targetAt);
  targetRef.current = targetAt;
  const hoverAt = (wx: number, wy: number, exclude: string | null) => setHover(targetRef.current(wx, wy, exclude));

  // A photo let go at (x, y), its top-left corner, in world units.
  const dropPhoto = (photo: CanvasPhoto, x: number, y: number): boolean => {
    setHover(null);
    const target = targetRef.current(x + TILE / 2, y + TILE / 2);
    const current = folderOf(photo);
    if (target !== null) {
      if (target === current) return false;
      onMove(photo, target).catch(() => {});
      return true;
    }
    // Onto the table: out of its folder, and where it was let go.
    save({ photos: { [photo.id]: { x: Math.round(x), y: Math.round(y) } } });
    if (current !== null) onMove(photo, null).catch(() => {});
    return true;
  };
  // A folder let go at (x, y), its top-left corner, in world units (`w`,
  // `h` its own size). Onto another folder: it goes inside. Onto the
  // table: a top-level folder where it was let go (already one - it
  // simply moves).
  const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null);
  const dropFolder = (path: string, x: number, y: number, w: number, h: number): boolean => {
    setHover(null);
    const target = targetRef.current(x + w / 2, y + h / 2, path);
    const parent = parentOf(path);
    const newParent = target;
    if (newParent === parent) {
      if (parent !== null) return false;
      save({ folders: { [path]: { x: Math.round(x), y: Math.round(y) } } });
      return true;
    }
    const newPath = newParent ? `${newParent}/${nameOf(path)}` : nameOf(path);
    if (folderPaths.includes(newPath)) {
      notify('Там уже є папка з такою назвою', `«${nameOf(path)}» лишилася, де була.`);
      return false;
    }
    if (newParent === null) save({ folders: { [newPath]: { x: Math.round(x), y: Math.round(y) } } });
    onMoveFolder(path, newParent).catch(() => {});
    return true;
  };
  const toggle = (path: string) => save({ open: { [path]: !layout.open[path] } });

  const canvas = { scale, canvasPan, pinch, hoverAt };
  const accentTint = withAlpha(S.accent, 0.14);

  return (
    <GestureDetector gesture={tableGesture}>
      <View style={styles.viewport} collapsable={false}>
        <Animated.View style={[styles.surface, surfaceStyle]}>
          {islands.map((island) => (
            <View
              key={`island:${island.path}`}
              pointerEvents="none"
              style={[
                styles.island,
                {
                  left: island.x + WORLD_HALF,
                  top: island.y + WORLD_HALF,
                  width: island.w,
                  height: island.h,
                  backgroundColor: hover === island.path ? accentTint : withAlpha(S.ink, 0.04),
                  borderColor: hover === island.path ? S.accent : S.line,
                },
              ]}
            />
          ))}
          {islands.flatMap((island) =>
            island.chips.map((chip) => (
              <Dragged
                key={`chip:${chip.path}`}
                x={chip.x}
                y={chip.y}
                w={chip.w}
                h={CHIP_H}
                canvas={canvas}
                carries={chip.path}
                onTap={() => toggle(chip.path)}
                onDrop={(x, y) => dropFolder(chip.path, x, y, chip.w, CHIP_H)}
              >
                <View style={[styles.chip, { backgroundColor: hover === chip.path ? accentTint : S.card }]}>
                  <Ionicons name={chip.open ? 'chevron-down' : 'chevron-forward'} size={14} color={S.ink3} />
                  <Ionicons name="folder-outline" size={16} color={S.ink2} />
                  <Text style={[styles.chipLabel, { color: S.ink }]} numberOfLines={1}>
                    {nameOf(chip.path)}
                  </Text>
                  <Text style={[styles.count, { color: S.ink3 }]}>{chip.count}</Text>
                </View>
              </Dragged>
            ))
          )}
          {nodes.map((node) => (
            <Dragged
              key={`node:${node.path}`}
              x={node.x}
              y={node.y}
              w={NODE_W}
              h={NODE_H}
              canvas={canvas}
              carries={node.path}
              onTap={() => toggle(node.path)}
              onDrop={(x, y) => dropFolder(node.path, x, y, NODE_W, NODE_H)}
            >
              <View
                style={[
                  styles.node,
                  {
                    backgroundColor: hover === node.path ? accentTint : S.card,
                    borderColor: hover === node.path ? S.accent : 'transparent',
                    boxShadow: S.shadow,
                  },
                ]}
              >
                <Ionicons name={node.open ? 'folder-open-outline' : 'folder-outline'} size={20} color={S.accent} />
                <Text style={[styles.nodeLabel, { color: S.ink }]} numberOfLines={1}>
                  {nameOf(node.path)}
                </Text>
                <Text style={[styles.count, { color: S.ink3 }]}>{node.count}</Text>
              </View>
            </Dragged>
          ))}
          {[...islands.flatMap((island) => island.tiles), ...looseTiles].map(({ photo, x, y }) => (
            <Dragged
              key={`photo:${photo.id}`}
              x={x}
              y={y}
              w={TILE}
              h={TILE}
              canvas={canvas}
              onTap={() => onOpenPhoto(photo)}
              onLongPress={() => onPhotoMenu(photo)}
              onDrop={(dx, dy) => dropPhoto(photo, dx, dy)}
            >
              <View style={[styles.tile, { backgroundColor: S.fill, boxShadow: S.shadow }]}>
                <AttachmentImage uri={photo.imageUri} driveFileId={photo.driveFileId} style={styles.tileImage} />
              </View>
            </Dragged>
          ))}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

type Canvas = {
  scale: SharedValue<number>;
  canvasPan: GestureType;
  pinch: GestureType;
  hoverAt: (wx: number, wy: number, exclude: string | null) => void;
};

// One thing on the table: where it stands (in world units), carried by a
// finger, tapped, held. Its own position is a shared value, so a drag moves
// it on the UI thread and a drop that lands where the record now says it
// is needs no reset at all; one that changes nothing springs it back.
function Dragged({
  x,
  y,
  w,
  h,
  canvas,
  movable = true,
  carries = null,
  onTap,
  onLongPress,
  onDrop,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  canvas: Canvas;
  movable?: boolean;
  // The folder this is, when it is one: never its own drop target.
  carries?: string | null;
  onTap?: () => void;
  onLongPress?: () => void;
  onDrop?: (x: number, y: number) => boolean;
  children: React.ReactNode;
}) {
  const px = useSharedValue(x);
  const py = useSharedValue(y);
  const dragging = useSharedValue(false);
  const from = useSharedValue({ x, y, hx: x, hy: y });
  useEffect(() => {
    if (dragging.value) return;
    px.value = x;
    py.value = y;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  const finish = (fx: number, fy: number) => {
    const moved = onDrop ? onDrop(fx, fy) : false;
    if (!moved) {
      px.value = withSpring(x, { damping: 18, stiffness: 180 });
      py.value = withSpring(y, { damping: 18, stiffness: 180 });
    }
  };

  // Taken out of `canvas` BEFORE any worklet sees them: a worklet copies
  // every identifier it names whole, and `canvas` also holds the table's
  // gestures - "Cannot copy value of type PanGesture" was the first open
  // of this view on the phone (2026-10-02; see the worklet closure memory).
  const canvasScale = canvas.scale;
  const hoverAt = canvas.hoverAt;
  const tablePan = canvas.canvasPan;
  const tablePinch = canvas.pinch;
  const gesture = useMemo(() => {
    const tap = Gesture.Tap().onEnd(() => {
      if (onTap) runOnJS(onTap)();
    });
    const hold = Gesture.LongPress()
      .minDuration(450)
      .onStart(() => {
        if (onLongPress) runOnJS(onLongPress)();
      });
    if (!movable) return Gesture.Race(tap);
    const pan = Gesture.Pan()
      .minDistance(4)
      .blocksExternalGesture(tablePan, tablePinch)
      .onStart(() => {
        dragging.value = true;
        from.value = { x: px.value, y: py.value, hx: px.value, hy: py.value };
      })
      .onUpdate((e) => {
        px.value = from.value.x + e.translationX / canvasScale.value;
        py.value = from.value.y + e.translationY / canvasScale.value;
        if (Math.abs(px.value - from.value.hx) + Math.abs(py.value - from.value.hy) > HOVER_STEP) {
          from.value = { ...from.value, hx: px.value, hy: py.value };
          runOnJS(hoverAt)(px.value + w / 2, py.value + h / 2, carries);
        }
      })
      .onEnd(() => {
        runOnJS(finish)(px.value, py.value);
      })
      .onFinalize(() => {
        dragging.value = false;
      });
    return Gesture.Race(pan, hold, tap);
    // The callbacks change every render; the gesture reads them through
    // runOnJS at the moment it fires, which is what it wants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, movable, carries, onTap, onLongPress, onDrop]);

  const style = useAnimatedStyle(() => ({
    left: px.value + WORLD_HALF,
    top: py.value + WORLD_HALF,
    zIndex: dragging.value ? 10 : 1,
    transform: [{ scale: dragging.value ? 1.06 : 1 }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.item, { width: w, height: h }, style]}>{children}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    overflow: 'hidden',
  },
  surface: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: WORLD_HALF * 2,
    height: WORLD_HALF * 2,
    transformOrigin: 'left top',
  },
  item: {
    position: 'absolute',
  },
  island: {
    position: 'absolute',
    borderRadius: 20,
    borderWidth: 1,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 14,
  },
  tileImage: {
    width: TILE,
    height: TILE,
    borderRadius: 14,
  },
  node: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: NODE_H / 2,
    borderWidth: 1.5,
  },
  nodeLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  chipLabel: {
    flex: 1,
    fontSize: 14,
  },
  count: {
    fontSize: 12,
  },
});
