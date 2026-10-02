import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { deleteField, doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { setDoc } from '../utils/owned';
import { useSoft } from '../theme/soft';
import { withAlpha } from '../utils/color';
import { Ionicons } from './icons/Ionicons';
import { ask, notify } from './surfaces/Ask';
import RenamePrompt from './RenamePrompt';
import { useDensity } from '../hooks/useDensity';
import { bindRightClick } from '../utils/rightClick';

// «ПОЛОТНО» - a database as a table (the user's, 2026-10-02; photos
// first, then files, links and notes - the tile is each one's own, see
// renderTile): a table the photos are
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
// A photo in two folders is drawn in both islands; carrying it out of one
// leaves it in the other. Held, a photo offers «Додати в іншу папку»: a
// pale copy (of it, or of all the chosen) is carried to a folder and
// lights up there - the photo is now in both.
//
// PILES: a thing dropped on a loose thing makes a pile there (and onto a
// pile, joins it) - drawn as a little stack with a count, carried whole
// (onto a folder, all of it goes in), tapped open into a panel to take
// things back out, held for «Розкласти на столі» / «У нову папку». Only
// loose things pile; one put into a folder leaves its pile.

// Any record with an id - what a tile shows is the database's own
// (renderTile). Named "photo" inside, where it was first written for.
export type CanvasPhoto = { id: string };

// What a layer drawn OVER the table needs to point at its folders (the
// folders' links to their databases, FolderBaseLinks): the table's own
// pan and zoom, and where each folder that can be seen stands, in world
// units - screen = (world + WORLD_HALF) * scale + translate.
export type FolderRect = { x: number; y: number; w: number; h: number };
export type CanvasOverlayApi = {
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  scale: SharedValue<number>;
  rects: Record<string, FolderRect>;
  // A folder's LIVE place while a finger carries it (world units, its top
  // left corner) - registered as `folder:<path>`; a line follows it there.
  live: (path: string) => { px: SharedValue<number>; py: SharedValue<number> } | undefined;
};
export type Move = { photo: CanvasPhoto; from: string | null };

// ONE PHOTO ON THE TABLE, in one place: loose, or in one folder's island.
// A photo in two folders is two of these, and carrying one takes the photo
// out of THAT folder only. Chosen and carried by its key.
type Instance = { key: string; photo: CanvasPhoto; folder: string | null; x: number; y: number; pile?: string };
const instanceKey = (photoId: string, folder: string | null) => `${photoId}@${folder ?? ''}`;

type Pos = { x: number; y: number };
// A PILE: loose things dropped on each other, carried as one (step three).
type PileRec = { x: number; y: number; ids: string[] };
type Layout = {
  photos: Record<string, Pos>;
  folders: Record<string, Pos>;
  open: Record<string, boolean>;
  piles: Record<string, PileRec>;
};
const EMPTY_LAYOUT: Layout = { photos: {}, folders: {}, open: {}, piles: {} };
// Not "__x__"-shaped: Firestore refuses such a field name.
const newPileId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// The world: a square this big around the origin, so everything on it
// stays inside its parent's bounds - on Android a child outside them is
// drawn but never touched (see the android overlay touch memory).
export const WORLD_HALF = 4000;
const TILE = 88;
// A tile's side, for the databases drawing their own faces.
export const CANVAS_TILE = TILE;
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
// A hold on an item (its menu); the table's rectangle waits longer.
const HOLD_MS = 350;

const nameOf = (path: string) => path.split('/').pop() ?? path;
const depthOf = (path: string) => path.split('/').length;

type Island = {
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tiles: Instance[];
  chips: { path: string; x: number; y: number; w: number; count: number; open: boolean }[];
};

export default function FolderCanvas({
  layoutKey,
  renderTile,
  titleOf,
  photos,
  folderPaths,
  foldersOf,
  onRelocate,
  onAdd,
  onMoveFolder,
  onCreateFolder,
  onOpenPhoto,
  onPhotoMenu,
  topPad,
  overlay,
  resetFolders,
}: {
  // Where the table's arrangement is kept: settings/<layoutKey>.
  layoutKey: string;
  // A tile's face (TILE x TILE): a photo, a file's icon and name, a note's
  // first lines.
  renderTile: (item: CanvasPhoto) => React.ReactNode;
  titleOf: (item: CanvasPhoto) => string;
  photos: CanvasPhoto[];
  folderPaths: string[];
  // Every folder a photo is in (a smart folder is a tag: a photo can be in
  // two) - it is drawn in each of their islands.
  foldersOf: (photo: CanvasPhoto) => string[];
  // Photos taken out of the folder each was carried from (null: it was
  // loose) and put into `to` (null: onto the table) - its other folders
  // untouched.
  onRelocate: (moves: Move[], to: string | null) => Promise<void>;
  // Photos put into `to` as well, staying where they are.
  onAdd: (photos: CanvasPhoto[], to: string) => Promise<void>;
  // A folder put into another (or, null, out to the top level).
  onMoveFolder: (path: string, parent: string | null) => Promise<void>;
  // A new top-level folder, with these photos put into it.
  onCreateFolder: (name: string, moves: Move[]) => Promise<void>;
  onOpenPhoto: (photo: CanvasPhoto) => void;
  onPhotoMenu: (photo: CanvasPhoto) => void;
  topPad: number;
  // Drawn over the table, in screen units (see CanvasOverlayApi).
  overlay?: (api: CanvasOverlayApi) => React.ReactNode;
  // «Упорядкувати»: each new value forgets where every folder was put, so
  // they all stand in their column again - "навіть якщо я натворив
  // хаосу" (a folder lost under another was the reason, 2026-10-02).
  resetFolders?: number;
}) {
  const S = useSoft();
  const { width: screenW } = useWindowDimensions();
  const canvasDoc = useMemo(() => doc(db, 'settings', layoutKey), [layoutKey]);
  // UNDER A MOUSE (the Mac app - where the user expects to do this most):
  // dragging the empty table draws the rectangle at once, Finder's way;
  // the table moves by two-finger scroll or the wheel and zooms by a
  // trackpad pinch or ⌘ + wheel (see the wheel effect below); a right
  // click is a hold; ⌘ or Shift + click adds to the chosen.
  const pointer = useDensity() === 'pointer';
  const viewportRef = useRef<View>(null);
  const modifierHeld = useRef(false);
  const [layout, setLayout] = useState<Layout>(EMPTY_LAYOUT);
  const [hover, setHover] = useState<string | null>(null);
  // THE SELECTION (step two): photos taken together - drawn round with a
  // rectangle, or tapped while something is already chosen - and carried
  // together: dragging any one of them carries them all.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Piles spread out beside themselves (this session).
  const [openPiles, setOpenPiles] = useState<Set<string>>(() => new Set());
  // What «+ Нова папка» is being named for: photos carried into it (moved),
  // photos added to it (pale copies), or nothing (a folder alone).
  const [newFolderFor, setNewFolderFor] = useState<{ moves: Move[]; adds: CanvasPhoto[] } | null>(null);
  // «Додати в іншу»: pale copies of these photos, carried to a folder they
  // are added to, where they light up. `seq` remakes the copy each time.
  const [ghost, setGhost] = useState<{ photos: CanvasPhoto[]; x: number; y: number; seq: number; landed: boolean } | null>(null);

  useEffect(
    () =>
      onSnapshot(
        canvasDoc,
        (snap: { data: () => Partial<Layout> | undefined }) => {
          const data = snap.data();
          setLayout({ photos: data?.photos ?? {}, folders: data?.folders ?? {}, open: data?.open ?? {}, piles: data?.piles ?? {} });
        },
        () => {}
      ),
    [canvasDoc]
  );
  const save = (patch: Partial<Layout>) => {
    setLayout((prev) => ({
      photos: { ...prev.photos, ...(patch.photos ?? {}) },
      folders: { ...prev.folders, ...(patch.folders ?? {}) },
      open: { ...prev.open, ...(patch.open ?? {}) },
      piles: { ...prev.piles, ...(patch.piles ?? {}) },
    }));
    setDoc(canvasDoc, patch, { merge: true }).catch(() => {});
  };
  useEffect(() => {
    if (!resetFolders) return;
    setLayout((prev) => ({ ...prev, folders: {} }));
    setDoc(canvasDoc, { folders: deleteField() }, { merge: true }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetFolders]);
  // Piles changed - each to its new record, or (null) gone.
  const savePiles = (changes: Record<string, PileRec | null>) => {
    setLayout((prev) => {
      const piles = { ...prev.piles };
      Object.entries(changes).forEach(([id, rec]) => {
        if (rec) piles[id] = rec;
        else delete piles[id];
      });
      return { ...prev, piles };
    });
    const patch: Record<string, unknown> = {};
    Object.entries(changes).forEach(([id, rec]) => {
      patch[id] = rec ?? deleteField();
    });
    setDoc(canvasDoc, { piles: patch }, { merge: true }).catch(() => {});
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
        .enabled(!pointer)
        .onStart(() => {
          start.value = { ...start.value, tx: tx.value, ty: ty.value };
        })
        .onUpdate((e) => {
          tx.value = start.value.tx + e.translationX;
          ty.value = start.value.ty + e.translationY;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pointer]
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
        // Longer than an item's own hold (HOLD_MS): a finger held on a
        // photo opens its menu, never a rectangle drawn from under it.
        // Under a mouse, at once.
        .activateAfterLongPress(pointer ? 0 : HOLD_MS + 150)
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
    [pointer]
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
  // The wheel and the trackpad (a pinch arrives as a wheel event with
  // ctrlKey - see hooks/useCanvasWheel, whose two step sizes these are).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = viewportRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!event.ctrlKey && !event.metaKey) {
        tx.value -= event.shiftKey ? event.deltaY : event.deltaX;
        ty.value -= event.shiftKey ? 0 : event.deltaY;
        return;
      }
      const from = scale.value;
      const pinch = Math.abs(event.deltaY) < 50;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, from * Math.exp(-event.deltaY * (pinch ? 0.012 : 0.0015))));
      if (next === from) return;
      const rect = node.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      // The point under the pointer stays under it.
      tx.value = px - (px - tx.value) * (next / from);
      ty.value = py - (py - ty.value) * (next / from);
      scale.value = next;
    };
    const keys = (event: KeyboardEvent) => {
      modifierHeld.current = event.metaKey || event.shiftKey;
    };
    const release = () => {
      modifierHeld.current = false;
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', keys);
    window.addEventListener('keyup', keys);
    window.addEventListener('blur', release);
    return () => {
      node.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', keys);
      window.removeEventListener('keyup', keys);
      window.removeEventListener('blur', release);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- where everything stands -------------------------------------------
  const topFolders = folderPaths.filter((p) => depthOf(p) === 1).sort((a, b) => a.localeCompare(b));
  const childrenOf = (path: string) =>
    folderPaths.filter((p) => p.startsWith(`${path}/`) && depthOf(p) === depthOf(path) + 1).sort((a, b) => a.localeCompare(b));
  const inFolder = new Map<string, CanvasPhoto[]>();
  const loose: CanvasPhoto[] = [];
  photos.forEach((photo) => {
    const folders = foldersOf(photo);
    if (!folders.length) loose.push(photo);
    folders.forEach((folder) => inFolder.set(folder, [...(inFolder.get(folder) ?? []), photo]));
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
      island.tiles.push({
        key: instanceKey(photo.id, path),
        photo,
        folder: path,
        x: x + ISLAND_PAD + col * (TILE + GAP),
        y: cursor + row * (TILE + GAP),
      });
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
  // Piles: of what is still loose, each member in one pile only; a pile
  // left with fewer than two is no pile - its last one lies where it was.
  const photoById = new Map(photos.map((p) => [p.id, p]));
  const looseIds = new Set(loose.map((p) => p.id));
  const pileOf = new Map<string, string>();
  const pileAt = new Map<string, Pos>();
  const piles: { id: string; x: number; y: number; items: CanvasPhoto[]; open: boolean }[] = [];
  Object.entries(layout.piles).forEach(([id, rec]) => {
    const members = rec.ids.filter((pid) => looseIds.has(pid) && !pileOf.has(pid));
    members.forEach((pid) => pileAt.set(pid, { x: rec.x, y: rec.y }));
    if (members.length < 2) return;
    members.forEach((pid) => pileOf.set(pid, id));
    piles.push({ id, x: rec.x, y: rec.y, items: members.map((pid) => photoById.get(pid)!), open: openPiles.has(id) });
  });
  let unplaced = 0;
  const looseTiles: Instance[] = loose
    .filter((photo) => !pileOf.has(photo.id))
    .map((photo) => {
      const key = instanceKey(photo.id, null);
      const saved = layout.photos[photo.id] ?? pileAt.get(photo.id);
      if (saved) return { key, photo, folder: null, x: saved.x, y: saved.y };
      const i = unplaced++;
      return { key, photo, folder: null, x: looseX + (i % looseCols) * (TILE + GAP), y: Math.floor(i / looseCols) * (TILE + GAP) };
    });
  // An open pile spreads its members in a panel under itself, each one an
  // item that can be carried out of it.
  const PILE_SIZE = TILE + 12;
  const pilePanels = piles
    .filter((pile) => pile.open)
    .map((pile) => {
      const cols = Math.min(3, pile.items.length);
      const x = pile.x;
      const y = pile.y + PILE_SIZE + GAP;
      const w = cols * TILE + (cols - 1) * GAP + ISLAND_PAD * 2;
      const rows = Math.ceil(pile.items.length / cols);
      const h = rows * TILE + (rows - 1) * GAP + ISLAND_PAD * 2;
      const tiles: Instance[] = pile.items.map((photo, i) => ({
        key: instanceKey(photo.id, null),
        photo,
        folder: null,
        pile: pile.id,
        x: x + ISLAND_PAD + (i % cols) * (TILE + GAP),
        y: y + ISLAND_PAD + Math.floor(i / cols) * (TILE + GAP),
      }));
      return { id: pile.id, x, y, w, h, tiles };
    });

  // ---- what is under a point ------------------------------------------------
  // Smallest first: a sub-folder line inside an island beats the island.
  // `exclude`: a folder being carried - it is never its own target, nor is
  // anything inside it.
  // `skipKeys`: the things being carried (instance keys, "pile:<id>") -
  // never their own target. Besides a folder's path and NEW_KEY this can
  // answer "pile:<id>" (onto a pile) and "item:<id>" (onto a loose thing,
  // making a pile) - only for things, never for a carried folder.
  const targetAt = (wx: number, wy: number, exclude: string | null = null, skipKeys?: Set<string>): string | null => {
    const skip = (path: string) => exclude !== null && (path === exclude || path.startsWith(`${exclude}/`));
    const inBox = (x: number, y: number, w: number, h: number) => wx >= x && wx <= x + w && wy >= y && wy <= y + h;
    if (exclude === null) {
      for (const pile of piles) {
        if (skipKeys?.has(`pile:${pile.id}`)) continue;
        if (inBox(pile.x, pile.y, PILE_SIZE, PILE_SIZE)) return `pile:${pile.id}`;
      }
      for (const panel of pilePanels) {
        if (skipKeys?.has(`pile:${panel.id}`)) continue;
        if (inBox(panel.x, panel.y, panel.w, panel.h)) return `pile:${panel.id}`;
      }
      for (const tile of looseTiles) {
        if (skipKeys?.has(tile.key)) continue;
        if (inBox(tile.x, tile.y, TILE, TILE)) return `item:${tile.photo.id}`;
      }
    }
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
  const skipFor = (me: string) => (me && selected.has(me) ? new Set([...selected, me]) : new Set([me]));
  const hoverAt = (wx: number, wy: number, exclude: string | null, me: string) =>
    setHover(targetRef.current(wx, wy, exclude, exclude === null ? skipFor(me) : undefined));

  // Where each photo stands now (world units), for carrying a selection.
  const instances: Instance[] = [...islands.flatMap((island) => island.tiles), ...pilePanels.flatMap((p) => p.tiles), ...looseTiles];
  const instanceByKey = new Map(instances.map((t) => [t.key, t]));
  const placeOf = new Map(instances.map((t) => [t.key, { x: t.x, y: t.y }]));
  const chosenInstances = () => Array.from(selected).map((k) => instanceByKey.get(k)).filter((t): t is Instance => !!t);
  const uniquePhotos = (list: Instance[]) => Array.from(new Map(list.map((t) => [t.photo.id, t.photo])).values());
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
  const dropPhoto = (inst: Instance, x: number, y: number): boolean => {
    setHover(null);
    const carried = selected.has(inst.key) ? chosenInstances() : [inst];
    const from = placeOf.get(inst.key) ?? { x, y };
    const dx = x - from.x;
    const dy = y - from.y;
    const target = targetRef.current(x + TILE / 2, y + TILE / 2, null, new Set(carried.map((t) => t.key)));
    // Out of the piles they were in (a pile left with one is no pile).
    const leavePiles = (except?: string) => {
      const changes: Record<string, PileRec | null> = {};
      const leavingIds = new Set(carried.map((t) => t.photo.id));
      Object.entries(layout.piles).forEach(([id, rec]) => {
        if (id === except || !rec.ids.some((pid) => leavingIds.has(pid))) return;
        const rest = rec.ids.filter((pid) => !leavingIds.has(pid));
        changes[id] = rest.length >= 2 ? { ...rec, ids: rest } : null;
      });
      if (Object.keys(changes).length) savePiles(changes);
    };
    const settleOthers = () => {
      // The others stand where they were drawn while carried, in the same
      // frame the shared offset goes - so nothing jumps back and forth.
      carried.forEach((t) => {
        if (t.key === inst.key) return;
        const reg = registry.current.get(t.key);
        if (reg) {
          reg.px.value += dx;
          reg.py.value += dy;
        }
      });
      group.value = { dx: 0, dy: 0, by: '' };
    };
    if (target === NEW_KEY) {
      group.value = { dx: 0, dy: 0, by: '' };
      setNewFolderFor({ moves: carried.map((t) => ({ photo: t.photo, from: t.folder })), adds: [] });
      return false;
    }
    // Onto a pile, or onto a loose thing (which becomes a pile with them):
    // out of their folders and other piles, into this one.
    if (target !== null && (target.startsWith('pile:') || target.startsWith('item:'))) {
      group.value = { dx: 0, dy: 0, by: '' };
      const ids = Array.from(new Set(carried.map((t) => t.photo.id)));
      const fromFolders = carried.filter((t) => t.folder !== null);
      if (target.startsWith('pile:')) {
        const pileId = target.slice(5);
        const rec = layout.piles[pileId];
        if (!rec) return false;
        // All of them in it already (taken out of its panel and put back):
        // nothing changes, so they spring back to their places.
        if (ids.every((id) => rec.ids.includes(id))) return false;
        leavePiles(pileId);
        savePiles({ [pileId]: { ...rec, ids: Array.from(new Set([...rec.ids, ...ids])) } });
      } else {
        const onto = target.slice(5);
        const at = placeOf.get(instanceKey(onto, null)) ?? { x, y };
        leavePiles();
        savePiles({ [newPileId()]: { x: Math.round(at.x), y: Math.round(at.y), ids: [onto, ...ids.filter((id) => id !== onto)] } });
      }
      if (fromFolders.length) onRelocate(fromFolders.map((t) => ({ photo: t.photo, from: t.folder })), null).catch(() => {});
      setSelected(new Set());
      return true;
    }
    if (target !== null) {
      const moving = carried.filter((t) => t.folder !== target);
      if (!moving.length) {
        group.value = { dx: 0, dy: 0, by: '' };
        return false;
      }
      settleOthers();
      leavePiles();
      onRelocate(moving.map((t) => ({ photo: t.photo, from: t.folder })), target).catch(() => {});
      setSelected(new Set());
      return true;
    }
    // Onto the table: out of the folder each came from, where it was let go.
    settleOthers();
    const placed: Record<string, Pos> = {};
    carried.forEach((t) => {
      const at = placeOf.get(t.key) ?? from;
      placed[t.photo.id] = { x: Math.round(at.x + dx), y: Math.round(at.y + dy) };
    });
    save({ photos: placed });
    leavePiles();
    const leaving = carried.filter((t) => t.folder !== null);
    if (leaving.length) onRelocate(leaving.map((t) => ({ photo: t.photo, from: t.folder })), null).catch(() => {});
    return true;
  };
  const tapPhoto = (inst: Instance) => {
    if (!selected.size && !modifierHeld.current) {
      onOpenPhoto(inst.photo);
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(inst.key)) next.delete(inst.key);
      else next.add(inst.key);
      return next;
    });
  };
  // Held: «Додати в іншу папку» (pale copies of it - of all the chosen,
  // when it is one of them), or the photo's own menu.
  const holdPhoto = async (inst: Instance) => {
    const answer = await ask({
      title: titleOf(inst.photo),
      actions: [
        { id: 'add', label: 'Додати в іншу папку', icon: 'copy-outline', hint: 'Лишиться і тут' },
        { id: 'more', label: 'Інші дії', icon: 'ellipsis-horizontal' },
      ],
    });
    if (answer === 'more') onPhotoMenu(inst.photo);
    if (answer !== 'add') return;
    const photosToAdd = selected.has(inst.key) ? uniquePhotos(chosenInstances()) : [inst.photo];
    setGhost((prev) => ({ photos: photosToAdd, x: inst.x + 18, y: inst.y + 18, seq: (prev?.seq ?? 0) + 1, landed: false }));
  };
  // The pale copies let go: on a folder they are added to it and light up
  // before they go; anywhere else they simply go.
  const dropGhost = (x: number, y: number): boolean => {
    setHover(null);
    const current = ghost;
    if (!current) return true;
    const target = targetRef.current(x + TILE / 2, y + TILE / 2);
    if (target === NEW_KEY) {
      setGhost(null);
      setNewFolderFor({ moves: [], adds: current.photos });
      return true;
    }
    if (target === null) {
      setGhost(null);
      return true;
    }
    setGhost({ ...current, x, y, landed: true });
    onAdd(current.photos, target).catch(() => {});
    setSelected(new Set());
    setTimeout(() => setGhost((g) => (g && g.seq === current.seq ? null : g)), 650);
    return true;
  };
  // A pile let go at (x, y): onto a folder - all of it into the folder;
  // onto «+ Нова папка» - all of it into a new one; onto another pile or a
  // loose thing - one pile; onto the table - it moves.
  const dropPile = (pile: { id: string; items: CanvasPhoto[] }, x: number, y: number): boolean => {
    setHover(null);
    const target = targetRef.current(x + PILE_SIZE / 2, y + PILE_SIZE / 2, null, new Set([`pile:${pile.id}`]));
    const rec = layout.piles[pile.id];
    if (!rec) return false;
    const ids = pile.items.map((p) => p.id);
    if (target === NEW_KEY) {
      setNewFolderFor({ moves: pile.items.map((photo) => ({ photo, from: null })), adds: [] });
      return false;
    }
    if (target?.startsWith('pile:')) {
      const other = layout.piles[target.slice(5)];
      if (!other) return false;
      savePiles({ [target.slice(5)]: { ...other, ids: Array.from(new Set([...other.ids, ...ids])) }, [pile.id]: null });
      return true;
    }
    if (target?.startsWith('item:')) {
      savePiles({ [pile.id]: { x: Math.round(x), y: Math.round(y), ids: Array.from(new Set([...ids, target.slice(5)])) } });
      return true;
    }
    if (target !== null) {
      savePiles({ [pile.id]: null });
      onRelocate(pile.items.map((photo) => ({ photo, from: null })), target).catch(() => {});
      return true;
    }
    savePiles({ [pile.id]: { ...rec, x: Math.round(x), y: Math.round(y) } });
    return true;
  };
  const togglePile = (id: string) =>
    setOpenPiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const holdPile = async (pile: { id: string; x: number; y: number; items: CanvasPhoto[] }) => {
    const answer = await ask({
      title: `Купка (${pile.items.length})`,
      actions: [
        { id: 'spread', label: 'Розкласти на столі', icon: 'grid-outline' },
        { id: 'folder', label: 'У нову папку', icon: 'folder-outline' },
      ],
    });
    if (answer === 'spread') {
      const placed: Record<string, Pos> = {};
      pile.items.forEach((photo, i) => {
        placed[photo.id] = { x: pile.x + (i % 3) * (TILE + GAP), y: pile.y + Math.floor(i / 3) * (TILE + GAP) };
      });
      save({ photos: placed });
      savePiles({ [pile.id]: null });
    }
    if (answer === 'folder') setNewFolderFor({ moves: pile.items.map((photo) => ({ photo, from: null })), adds: [] });
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
  // Every folder that can be seen: a top-level node, or a sub-folder's
  // line inside an open island.
  const folderRects: Record<string, FolderRect> = {};
  nodes.forEach((node) => {
    folderRects[node.path] = { x: node.x, y: node.y, w: NODE_W, h: NODE_H };
  });
  islands.forEach((island) =>
    island.chips.forEach((chip) => {
      folderRects[chip.path] = { x: chip.x, y: chip.y, w: chip.w, h: CHIP_H };
    })
  );
  const accentTint = withAlpha(S.accent, 0.14);

  return (
    <View style={styles.viewport}>
    <GestureDetector gesture={tableGesture}>
      <View ref={viewportRef} style={styles.viewport} collapsable={false}>
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
                id={`folder:${chip.path}`}
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
              id={`folder:${node.path}`}
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
            onTap={() => setNewFolderFor({ moves: chosenInstances().map((t) => ({ photo: t.photo, from: t.folder })), adds: [] })}
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
          {pilePanels.map((panel) => (
            <View
              key={`pilepanel:${panel.id}`}
              pointerEvents="none"
              style={[
                styles.island,
                {
                  left: panel.x + WORLD_HALF,
                  top: panel.y + WORLD_HALF,
                  width: panel.w,
                  height: panel.h,
                  backgroundColor: hover === `pile:${panel.id}` ? accentTint : withAlpha(S.ink, 0.04),
                  borderColor: hover === `pile:${panel.id}` ? S.accent : S.line,
                  borderStyle: 'dashed',
                },
              ]}
            />
          ))}
          {piles.map((pile) => (
            <Dragged
              key={`pile:${pile.id}`}
              id={`pile:${pile.id}`}
              x={pile.x}
              y={pile.y}
              w={PILE_SIZE}
              h={PILE_SIZE}
              canvas={canvas}
              onTap={() => togglePile(pile.id)}
              onLongPress={() => holdPile(pile)}
              onDrop={(px, py) => dropPile(pile, px, py)}
            >
              <View style={styles.fill}>
                {pile.items.slice(0, 3).map((photo, i, top) => (
                  <View
                    key={photo.id}
                    style={[
                      styles.tile,
                      styles.pileTile,
                      {
                        left: i * 5,
                        top: i * 5,
                        backgroundColor: S.fill,
                        boxShadow: S.shadow,
                        borderColor: hover === `pile:${pile.id}` && i === top.length - 1 ? S.accent : 'transparent',
                        transform: [{ rotate: `${(i - (top.length - 1) / 2) * 4}deg` }],
                      },
                    ]}
                  >
                    {renderTile(photo)}
                  </View>
                ))}
                <View style={[styles.ghostCount, { backgroundColor: pile.open ? S.ink : S.accent }]}>
                  <Text style={styles.ghostCountLabel}>{pile.items.length}</Text>
                </View>
              </View>
            </Dragged>
          ))}
          {instances.map((inst) => (
            <Dragged
              key={`photo:${inst.key}`}
              id={inst.key}
              selected={selected.has(inst.key)}
              x={inst.x}
              y={inst.y}
              w={TILE}
              h={TILE}
              canvas={canvas}
              onTap={() => tapPhoto(inst)}
              onLongPress={() => holdPhoto(inst)}
              onDrop={(dx, dy) => dropPhoto(inst, dx, dy)}
            >
              <View
                style={[
                  styles.tile,
                  { backgroundColor: S.fill, boxShadow: S.shadow },
                  selected.has(inst.key) && { borderWidth: 3, borderColor: S.accent },
                  hover === `item:${inst.photo.id}` && inst.folder === null && !inst.pile && { borderWidth: 3, borderColor: S.accent },
                ]}
              >
                {renderTile(inst.photo)}
              </View>
            </Dragged>
          ))}
          {ghost && (
            <Dragged
              key={`ghost:${ghost.seq}`}
              x={ghost.x}
              y={ghost.y}
              w={TILE + 12}
              h={TILE + 12}
              canvas={canvas}
              onTap={() => setGhost(null)}
              onDrop={dropGhost}
            >
              <View style={{ opacity: ghost.landed ? 1 : 0.45 }}>
                {ghost.photos.slice(0, 3).map((photo, i) => (
                  <View
                    key={photo.id}
                    style={[
                      styles.tile,
                      styles.ghostTile,
                      { left: i * 6, top: i * 6, backgroundColor: S.fill, borderColor: ghost.landed ? S.accent : S.line },
                    ]}
                  >
                    {renderTile(photo)}
                  </View>
                ))}
                {ghost.photos.length > 1 && (
                  <View style={[styles.ghostCount, { backgroundColor: S.accent }]}>
                    <Text style={styles.ghostCountLabel}>{ghost.photos.length}</Text>
                  </View>
                )}
              </View>
            </Dragged>
          )}
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
          title={
            newFolderFor && newFolderFor.moves.length + newFolderFor.adds.length
              ? `Нова папка (${newFolderFor.moves.length + newFolderFor.adds.length})`
              : 'Нова папка'
          }
          initialValue=""
          placeholder="Назва папки"
          onCancel={() => setNewFolderFor(null)}
          onSave={(name) => {
            const clean = name.trim().replace(/\//g, ' ');
            const items = newFolderFor ?? { moves: [], adds: [] };
            setNewFolderFor(null);
            if (!clean) return;
            if (folderPaths.includes(clean)) {
              notify('Така папка вже є', `Перетягни на «${clean}».`);
              return;
            }
            setSelected(new Set());
            onCreateFolder(clean, items.moves)
              .then(() => (items.adds.length ? onAdd(items.adds, clean) : undefined))
              .catch(() => {});
          }}
        />
      </View>
    </GestureDetector>
    {overlay?.({ tx, ty, scale, rects: folderRects, live: (path) => registry.current.get(`folder:${path}`) })}
    </View>
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
  hoverAt: (wx: number, wy: number, exclude: string | null, me: string) => void;
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
      .blocksExternalGesture(tableTap, tableMarquee)
      .onEnd(() => {
        if (onTap) runOnJS(onTap)();
      });
    const hold = Gesture.LongPress()
      .minDuration(HOLD_MS)
      // The table waits for this: held on a photo, the photo's own menu -
      // the rectangle once took the hold and chose the photo on release
      // instead (2026-10-02).
      .blocksExternalGesture(tableMarquee, tablePan, tableTap)
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
          runOnJS(hoverAt)(px.value + w / 2, py.value + h / 2, carries, me);
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
      <Animated.View style={[styles.item, { width: w, height: h }, style]}>
        {/* A right click is a hold (the laptop's - nothing on a phone). */}
        <View ref={(node) => bindRightClick(node, onLongPress)} style={styles.fill}>
          {children}
        </View>
      </Animated.View>
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
  fill: {
    flex: 1,
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
    overflow: 'hidden',
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
  pileTile: {
    position: 'absolute',
    borderWidth: 2,
  },
  ghostTile: {
    position: 'absolute',
    borderWidth: 2,
  },
  ghostCount: {
    position: 'absolute',
    right: -4,
    top: -6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  ghostCountLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
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
