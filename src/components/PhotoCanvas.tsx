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
import RenamePrompt from './RenamePrompt';

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
  onCreateFolder,
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
  // A new top-level folder, with these photos put into it.
  onCreateFolder: (name: string, photos: CanvasPhoto[]) => Promise<void>;
  onOpenPhoto: (photo: CanvasPhoto) => void;
  onPhotoMenu: (photo: CanvasPhoto) => void;
  topPad: number;
}) {
  const S = useSoft();
  const { width: screenW } = useWindowDimensions();
  const [layout, setLayout] = useState<Layout>(EMPTY_LAYOUT);
  const [hover, setHover] = useState<string | null>(null);
  // THE SELECTION (step two): photos taken together - drawn round with a
  // rectangle, or tapped while something is already chosen - and carried
  // together: dragging any one of them carries them all.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // The photos «+ Нова папка» is being named for (empty: a folder alone).
  const [newFolderFor, setNewFolderFor] = useState<CanvasPhoto[] | null>(null);

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
  // A finger held still on the table, then moved, draws the rectangle
  // (moved at once, it moves the table). World units throughout.
  const marquee = useSharedValue({ x0: 0, y0: 0, x1: 0, y1: 0, on: false });
  const selectInRef = useRef<(r: { x0: number; y0: number; x1: number; y1: number }) => void>(() => {});
  const selectIn = (r: { x0: number; y0: number; x1: number; y1: number }) => selectInRef.current(r);
  const clearSelection = () => setSelected((prev) => (prev.size ? new Set() : prev));
  const marqueePan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .activateAfterLongPress(320)
        .onStart((e) => {
          const wx = (e.x - tx.value) / scale.value - WORLD_HALF;
          const wy = (e.y - ty.value) / scale.value - WORLD_HALF;
          marquee.value = { x0: wx, y0: wy, x1: wx, y1: wy, on: true };
        })
        .onUpdate((e) => {
          marquee.value = {
            ...marquee.value,
            x1: (e.x - tx.value) / scale.value - WORLD_HALF,
            y1: (e.y - ty.value) / scale.value - WORLD_HALF,
          };
        })
        .onEnd(() => {
          runOnJS(selectIn)({ x0: marquee.value.x0, y0: marquee.value.y0, x1: marquee.value.x1, y1: marquee.value.y1 });
        })
        .onFinalize(() => {
          marquee.value = { ...marquee.value, on: false };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const tableTap = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        runOnJS(clearSelection)();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const tableGesture = useMemo(
    () => Gesture.Simultaneous(Gesture.Exclusive(marqueePan, canvasPan, tableTap), pinch),
    [marqueePan, canvasPan, tableTap, pinch]
  );
  const marqueeStyle = useAnimatedStyle(() => {
    const m = marquee.value;
    return {
      opacity: m.on ? 1 : 0,
      left: Math.min(m.x0, m.x1) + WORLD_HALF,
      top: Math.min(m.y0, m.y1) + WORLD_HALF,
      width: Math.abs(m.x1 - m.x0),
      height: Math.abs(m.y1 - m.y0),
    };
  });
  // Carrying a selection: the offset the carried one has moved by, which
  // every other chosen photo is drawn with too, and who is carrying.
  const group = useSharedValue({ dx: 0, dy: 0, by: '' });
  const registry = useRef(new Map<string, { px: SharedValue<number>; py: SharedValue<number> }>());
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

  // «+ Нова папка»: tapped, or with photos dropped on it, it asks for a
  // name and makes the folder (with them in it). Where it was put, or at
  // the end of the folders' column. Its key avoids "__x__" - a Firestore
  // field named like that is refused.
  const NEW_KEY = '+new';
  const newNode = { x: layout.folders[NEW_KEY]?.x ?? 0, y: layout.folders[NEW_KEY]?.y ?? columnY };

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
    if (exclude === null && wx >= newNode.x && wx <= newNode.x + NODE_W && wy >= newNode.y && wy <= newNode.y + NODE_H) {
      return NEW_KEY;
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

  // Where each photo stands now (world units), for carrying a selection.
  const placeOf = new Map<string, { x: number; y: number }>();
  [...islands.flatMap((island) => island.tiles), ...looseTiles].forEach((t) => placeOf.set(t.photo.id, { x: t.x, y: t.y }));
  const photoById = new Map(photos.map((p) => [p.id, p]));
  selectInRef.current = (r) => {
    const x0 = Math.min(r.x0, r.x1);
    const x1 = Math.max(r.x0, r.x1);
    const y0 = Math.min(r.y0, r.y1);
    const y1 = Math.max(r.y0, r.y1);
    const inside = Array.from(placeOf.entries())
      .filter(([, at]) => at.x + TILE > x0 && at.x < x1 && at.y + TILE > y0 && at.y < y1)
      .map(([id]) => id);
    if (inside.length) setSelected((prev) => new Set([...prev, ...inside]));
  };

  // A photo let go at (x, y), its top-left corner, in world units - and,
  // when it is one of the chosen, all the chosen with it.
  const dropPhoto = (photo: CanvasPhoto, x: number, y: number): boolean => {
    setHover(null);
    const carried = selected.has(photo.id) ? Array.from(selected).map((id) => photoById.get(id)).filter((p): p is CanvasPhoto => !!p) : [photo];
    const from = placeOf.get(photo.id) ?? { x, y };
    const dx = x - from.x;
    const dy = y - from.y;
    const target = targetRef.current(x + TILE / 2, y + TILE / 2);
    const settleOthers = () => {
      // The others stand where they were drawn while carried, in the same
      // frame the shared offset goes - so nothing jumps back and forth.
      carried.forEach((p) => {
        if (p.id === photo.id) return;
        const reg = registry.current.get(p.id);
        if (reg) {
          reg.px.value += dx;
          reg.py.value += dy;
        }
      });
      group.value = { dx: 0, dy: 0, by: '' };
    };
    if (target === NEW_KEY) {
      group.value = { dx: 0, dy: 0, by: '' };
      setNewFolderFor(carried);
      return false;
    }
    if (target !== null) {
      const moving = carried.filter((p) => folderOf(p) !== target);
      if (!moving.length) {
        group.value = { dx: 0, dy: 0, by: '' };
        return false;
      }
      settleOthers();
      moving.forEach((p) => onMove(p, target).catch(() => {}));
      setSelected(new Set());
      return true;
    }
    // Onto the table: out of their folders, each where it was let go.
    settleOthers();
    const placed: Record<string, Pos> = {};
    carried.forEach((p) => {
      const at = placeOf.get(p.id) ?? from;
      placed[p.id] = { x: Math.round(at.x + dx), y: Math.round(at.y + dy) };
    });
    save({ photos: placed });
    carried.forEach((p) => {
      if (folderOf(p) !== null) onMove(p, null).catch(() => {});
    });
    return true;
  };
  const tapPhoto = (photo: CanvasPhoto) => {
    if (!selected.size) {
      onOpenPhoto(photo);
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photo.id)) next.delete(photo.id);
      else next.add(photo.id);
      return next;
    });
  };
  // A folder let go at (x, y), its top-left corner, in world units (`w`,
  // `h` its own size). Onto another folder: it goes inside. Onto the
  // table: a top-level folder where it was let go (already one - it
  // simply moves).
  const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null);
  const dropFolder = (path: string, x: number, y: number, w: number, h: number): boolean => {
    setHover(null);
    const target = targetRef.current(x + w / 2, y + h / 2, path);
    if (target === NEW_KEY) return false;
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

  const canvas = { scale, canvasPan, pinch, tableTap, marqueePan, hoverAt, group, registry: registry.current };
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
          <Dragged
            key="node:+new"
            x={newNode.x}
            y={newNode.y}
            w={NODE_W}
            h={NODE_H}
            canvas={canvas}
            onTap={() => setNewFolderFor(Array.from(selected).map((id) => photoById.get(id)).filter((p): p is CanvasPhoto => !!p))}
            onDrop={(x, y) => {
              save({ folders: { [NEW_KEY]: { x: Math.round(x), y: Math.round(y) } } });
              return true;
            }}
          >
            <View
              style={[
                styles.node,
                styles.newNode,
                { borderColor: hover === NEW_KEY ? S.accent : S.line, backgroundColor: hover === NEW_KEY ? accentTint : 'transparent' },
              ]}
            >
              <Ionicons name="add" size={20} color={S.ink2} />
              <Text style={[styles.nodeLabel, { color: S.ink2 }]} numberOfLines={1}>
                Нова папка
              </Text>
            </View>
          </Dragged>
          {[...islands.flatMap((island) => island.tiles), ...looseTiles].map(({ photo, x, y }) => (
            <Dragged
              key={`photo:${photo.id}`}
              id={photo.id}
              selected={selected.has(photo.id)}
              x={x}
              y={y}
              w={TILE}
              h={TILE}
              canvas={canvas}
              onTap={() => tapPhoto(photo)}
              onLongPress={() => onPhotoMenu(photo)}
              onDrop={(dx, dy) => dropPhoto(photo, dx, dy)}
            >
              <View
                style={[
                  styles.tile,
                  { backgroundColor: S.fill, boxShadow: S.shadow },
                  selected.has(photo.id) && { borderWidth: 3, borderColor: S.accent },
                ]}
              >
                <AttachmentImage uri={photo.imageUri} driveFileId={photo.driveFileId} style={styles.tileImage} />
              </View>
            </Dragged>
          ))}
          <Animated.View
            pointerEvents="none"
            style={[styles.marquee, { borderColor: S.accent, backgroundColor: withAlpha(S.accent, 0.1) }, marqueeStyle]}
          />
        </Animated.View>
        {selected.size > 0 && (
          <View pointerEvents="none" style={[styles.selectionNote, { top: topPad + 8, backgroundColor: S.ink }]}>
            <Text style={[styles.selectionNoteLabel, { color: S.chrome }]}>Вибрано {selected.size}</Text>
          </View>
        )}
        <RenamePrompt
          visible={newFolderFor !== null}
          title={newFolderFor?.length ? `Нова папка для ${newFolderFor.length} фото` : 'Нова папка'}
          initialValue=""
          placeholder="Назва папки"
          onCancel={() => setNewFolderFor(null)}
          onSave={(name) => {
            const clean = name.trim().replace(/\//g, ' ');
            const items = newFolderFor ?? [];
            setNewFolderFor(null);
            if (!clean) return;
            if (folderPaths.includes(clean)) {
              notify('Така папка вже є', `Перетягни фото на «${clean}».`);
              return;
            }
            setSelected(new Set());
            onCreateFolder(clean, items).catch(() => {});
          }}
        />
      </View>
    </GestureDetector>
  );
}

type Canvas = {
  scale: SharedValue<number>;
  canvasPan: GestureType;
  pinch: GestureType;
  tableTap: GestureType;
  marqueePan: GestureType;
  group: SharedValue<{ dx: number; dy: number; by: string }>;
  registry: Map<string, { px: SharedValue<number>; py: SharedValue<number> }>;
  hoverAt: (wx: number, wy: number, exclude: string | null) => void;
};

// One thing on the table: where it stands (in world units), carried by a
// finger, tapped, held. Its own position is a shared value, so a drag moves
// it on the UI thread and a drop that lands where the record now says it
// is needs no reset at all; one that changes nothing springs it back.
function Dragged({
  id,
  selected = false,
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
  // A photo's id, and whether it is one of the chosen (carried together).
  id?: string;
  selected?: boolean;
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
  const tableTap = canvas.tableTap;
  const tableMarquee = canvas.marqueePan;
  const group = canvas.group;
  const registry = canvas.registry;
  const me = id ?? '';
  const chosen = selected;
  // Known to the canvas by its position values, so a dropped selection can
  // set where each of the others now stands in the same frame.
  useEffect(() => {
    if (!id) return;
    registry.set(id, { px, py });
    return () => {
      if (registry.get(id)?.px === px) registry.delete(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const gesture = useMemo(() => {
    const tap = Gesture.Tap()
      .blocksExternalGesture(tableTap)
      .onEnd(() => {
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
      .blocksExternalGesture(tablePan, tablePinch, tableTap, tableMarquee)
      .onStart(() => {
        dragging.value = true;
        from.value = { x: px.value, y: py.value, hx: px.value, hy: py.value };
      })
      .onUpdate((e) => {
        px.value = from.value.x + e.translationX / canvasScale.value;
        py.value = from.value.y + e.translationY / canvasScale.value;
        if (chosen) group.value = { dx: px.value - from.value.x, dy: py.value - from.value.y, by: me };
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
  }, [x, y, movable, carries, chosen, onTap, onLongPress, onDrop]);

  const style = useAnimatedStyle(() => {
    // Another chosen photo being carried: this one goes along.
    const along = chosen && group.value.by !== '' && group.value.by !== me;
    return {
      left: px.value + (along ? group.value.dx : 0) + WORLD_HALF,
      top: py.value + (along ? group.value.dy : 0) + WORLD_HALF,
      zIndex: dragging.value || along ? 10 : 1,
      transform: [{ scale: dragging.value ? 1.06 : 1 }],
    };
  });

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
  newNode: {
    borderStyle: 'dashed',
  },
  marquee: {
    position: 'absolute',
    borderWidth: 1.5,
    borderRadius: 8,
  },
  selectionNote: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  selectionNoteLabel: {
    fontSize: 13,
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
