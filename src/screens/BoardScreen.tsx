import { useStyles, useTheme } from '../theme/ThemeProvider';
import { mutedForTheme, type Theme } from '../theme/tokens';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
// gesture-handler's ScrollView for the outline: it lives over a canvas
// that claims pans of its own, and the core RN one loses the drag to it.
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  makeMutable,
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Ellipse, Path, Polygon, Rect } from 'react-native-svg';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import {
  collection,
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
  updateDoc,
} from '../firestore';
import { addDoc, setDoc } from '../utils/owned';
import { applyLiveRecord, recordIdFor, useLiveRecords } from '../hooks/useLiveRecords';
import * as Clipboard from 'expo-clipboard';
import { copyObject, labelForBlock } from '../utils/objectClipboard';
import { db } from '../firebase';
import { BoardsStackParamList, RootStackParamList } from '../navigation';
import { Block, BoardCard, BoardColumn, BoardConnection, BoardContainer, BoardLayer, BoardShape, BoardShapeKind } from '../types';
import { useCardCarry } from '../hooks/useCardCarry';
import CardCarryOverlay from '../components/CardCarryOverlay';
import CustomRowBlockCard from '../components/CustomRowBlockCard';
import { hapticDrop, hapticPickUp, hapticSuccess } from '../utils/haptics';
import {
  APPROX_CARD_HEIGHT,
  COLUMN_CARD_GAP,
  COLUMN_HEADER_HEIGHT,
  COLUMN_MIN_HEIGHT,
  COLUMN_PADDING,
  widthInColumn,
  clampCardWidth,
  cardImageHeight,
  CARD_IMAGE_PADDING,
  COLUMN_SPACING,
  COLUMN_WIDTH,
  DEFAULT_CARD_WIDTH,
  WORLD_CENTER,
  WORLD_SIZE,
  CONTAINER_HEADER_HEIGHT,
  CONTAINER_DEFAULT_WIDTH,
  CONTAINER_DEFAULT_HEIGHT,
  CONTAINER_SPACING,
  clampContainerWidth,
  clampContainerHeight,
} from '../utils/boardLayout';
import AddExistingItemModal from '../components/AddExistingItemModal';
import RenamePrompt from '../components/RenamePrompt';
import VideoPlayerModal from '../components/VideoPlayerModal';
import { getVideoEmbedInfo } from '../utils/videoEmbed';
import { fetchLinkPreview, LinkPreview } from '../utils/linkPreview';
import { linkDocId } from '../utils/linkId';
import { blockFromFile, blockFromLink, blockFromPhoto } from '../utils/copyToNote';
import { backupFileToDrive } from '../utils/googleDrive';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { contentEqual } from '../utils/contentEqual';
import { keyedAll, keyedDiff, readBoardPart } from '../utils/boardStorage';
import GroupImportSheet from '../components/GroupImportSheet';
import { useGroupItems } from '../hooks/useGroupItems';
import { importGroupToBoard } from '../utils/importGroupToBoard';
import { Group } from '../types';
import DocumentEditorScreen from './DocumentEditorScreen';
import { useCanvasWheel } from '../hooks/useCanvasWheel';
import { useAttachmentSource } from '../hooks/useAttachmentSource';
import { useContextMenu } from '../hooks/useContextMenu';
import Menu, { MENU_WIDTH } from '../components/surfaces/Menu';
import { FONT_BOLD, FONT_EXTRABOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import {
  GLASS_BODY_BLURRED,
  GLASS_CARD,
  GLASS_EDGE,
  GLASS_ISLAND,
  GLASS_TEXT,
  GLASS_TEXT_FAINT,
  GLASS_TEXT_MUTED,
  SHEET_BACKDROP,
  SHEET_WINDOW,
} from '../constants/glass';
import { GlassPortal } from '../components/GlassPortal';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { BlurView } from 'expo-blur';
import { useIsFocused } from '@react-navigation/native';
import { useBlurTarget } from '../components/GlassTarget';
import { useDockClearance } from '../navigation/dockGeometry';
import { useDockActions, useDockBeads, useDockLeave } from '../navigation/navDock';
import { ask, confirm } from '../components/surfaces/Ask';

const AUTOSAVE_DELAY_MS = 600;
const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
// Isolation's own ceiling on fitting a chain into view - lower than the
// pinch's own MAX_SCALE on purpose. A chain of one or two small objects
// fit-to-bounds against the ordinary ceiling would blow up to fill the
// whole screen at an absurd size; this caps how far "fit it in frame"
// alone is allowed to zoom in, independent of how close a finger could
// still pinch afterwards.
const ISOLATE_MAX_SCALE = 1.6;
// How much of the viewport a fitted chain actually fills - short of all
// of it, so the isolated objects never sit flush against the screen's
// own edges.
const ISOLATE_FIT_FRACTION = 0.82;
// A large fixed virtual canvas rather than an unbounded one - card x/y are
// plain offsets from this world's own top-left, and the world container
// itself starts centered on screen (see canvasSurface/world styles), so
// WORLD_CENTER is where a freshly created card lands by default.
// The six a sticky card can be. STORED as they are - the colour is the
// user's own choice and must survive a change of theme - but DRAWN
// through `mutedForTheme`: #FEF3C7 on a near-black canvas is a torch,
// and blended most of the way into the theme's own surface the card
// stays recognisable as "the yellow one" while it stops being the
// brightest thing on the screen. In the colour theme mutedForTheme
// hands the colour back untouched, so nothing moves there.
//
// Muted HARDER than the app's default 0.62, because a sticky fills a
// whole card rather than a chip beside a row, and area is light: at the
// default the six of them came out well above the plain card's own fill
// and the board read as a handful of lamps again. At 0.72 a coloured
// card is still clearly more present than a plain one - which is the
// point of colouring it - without being the brightest thing there.
// The board's furniture - see BoardShape in types.ts.
const SHAPE_STROKE = 2;
const SHAPE_MIN = 48;
// A loose label is as tall as its own words, which nothing measures. The
// same kind of stand-in APPROX_CARD_HEIGHT is, and used for the same two
// things: aiming an arrow at it, and hit-testing.
const SHAPE_TEXT_HEIGHT = 34;
// A loose label is as WIDE as its own words too, now - it used to be
// born at a fixed 180 and stay there forever, so raising its font size
// (or typing more into it) just wrapped the same box onto more lines
// instead of the box growing: "текст з фіксованою шириною переноситься
// на іншу строку при збільшенні його розміру". The box itself (see
// DraggableShape) auto-sizes to its own Text now, the same way its
// height already did; this is only the STAND-IN used where nothing
// actually measures the rendered box - aiming an arrow at it, same as
// SHAPE_TEXT_HEIGHT above.
function approxTextShapeWidth(text: string, fontSize: number): number {
  return Math.max(SHAPE_MIN, Math.round((text || 'Текст').length * fontSize * 0.55) + 16);
}
// A STEP, never a free number - the request was "make it readable from
// across the board", not fine typographic control, and a stepper is
// what a corner grip already does for size (see clampShapeSize) rather
// than a slider or a numeric field neither input method here suits.
const SHAPE_TEXT_SIZES = [12, 14, 16, 20, 26, 32];
const SHAPE_TEXT_SIZE_DEFAULT = 16;
const SHAPE_LABEL_SIZE_DEFAULT = 14;
function stepTextSize(current: number, dir: 1 | -1): number {
  const at = SHAPE_TEXT_SIZES.findIndex((v) => v >= current);
  const i = at < 0 ? SHAPE_TEXT_SIZES.length - 1 : at;
  const next = Math.max(0, Math.min(SHAPE_TEXT_SIZES.length - 1, i + dir));
  return SHAPE_TEXT_SIZES[next];
}
// The step itself, as "2/6" - the user's own ask: a number to compare
// by, not a size to judge by eye ("щоб я не на око а по цифрах міг
// порівнювати який розмір шрифту зараз вибраний"). Shown next to every
// stepper that steps through SHAPE_TEXT_SIZES, so a shape's own text and
// a container's title read on the one shared scale.
function textSizeStepLabel(current: number): string {
  const at = SHAPE_TEXT_SIZES.findIndex((v) => v >= current);
  const i = at < 0 ? SHAPE_TEXT_SIZES.length - 1 : at;
  return `${i + 1}/${SHAPE_TEXT_SIZES.length}`;
}
// The fill is the outline's own colour, much weaker - so a shape stays
// describable by one colour instead of two. 'none' when the user has
// not turned the wash on, which keeps every shape made before this an
// outline, exactly as it drew before.
function shapeFillFor(shape: BoardShape, stroke: string, theme: Theme): string {
  if (!shape.filled) return 'none';
  return mutedForTheme(stroke, theme, 0.88, theme.canvas.card);
}
const SHAPE_MAX = 900;
const clampShapeSize = (v: number) => Math.round(Math.max(SHAPE_MIN, Math.min(SHAPE_MAX, v)));
// What each kind is born as. A square and a circle are born square and
// stay square; the others are free.
const SHAPE_BIRTH: Record<BoardShapeKind, { width: number; height: number }> = {
  text: { width: 180, height: 0 },
  rect: { width: 180, height: 110 },
  square: { width: 140, height: 140 },
  triangle: { width: 160, height: 140 },
  diamond: { width: 160, height: 140 },
  ellipse: { width: 180, height: 110 },
  circle: { width: 140, height: 140 },
};
const SHAPE_MENU: { kind: BoardShapeKind; label: string; icon: string }[] = [
  { kind: 'text', label: 'Текст', icon: 'format-text' },
  { kind: 'rect', label: 'Прямокутник', icon: 'rectangle-outline' },
  { kind: 'square', label: 'Квадрат', icon: 'square-outline' },
  { kind: 'triangle', label: 'Трикутник', icon: 'triangle-outline' },
  { kind: 'diamond', label: 'Ромб', icon: 'rhombus-outline' },
  { kind: 'circle', label: 'Коло', icon: 'circle-outline' },
  { kind: 'ellipse', label: 'Овал', icon: 'ellipse-outline' },
];

const STICKY_MUTE = 0.72;
const STICKY_COLORS = ['#FEF3C7', '#DBEAFE', '#DCFCE7', '#FCE7F3', '#EDE9FE', '#FFE4E6'];
// Cards don't carry their own rendered height (only width) - close enough
// for hit-testing the marquee-selection rectangle against, not meant to be
// pixel-exact.
const SELECTION_COLOR = '#2563EB';
// The foot the selection bar keeps clear for the dock - the same
// reckoning DatabaseChrome makes.
// Kanban columns. A column is exactly wide enough for a default card plus
// its own padding on both sides, so a card dropped in sits flush.
// A column with nothing in it still has to be a visible drop target.
// How far outside a column's own bounds a dropped card still gets pulled
// into it. Generous on purpose - dropping a card "at" a column shouldn't
// require landing inside its box.
// The boards section's own colour, the same one BoardsListScreen uses - it
// was written into the "+" button's style as a number, which is how a
// screen ends up with a colour nothing else knows about.
const ACCENT = '#8B5CF6';
// The same half-strength tint the documents screen's add button uses.
const ACCENT_GLASS = 'rgba(139,92,246,0.55)';
// Raised from 90: a card was coming loose from its column on the
// slightest drag, which is the wrong default - a card in a column is
// almost always meant to stay in it, and pulling one out deliberately is
// the rarer move.
// How far outside a column still counts as dropping into it. Generous
// enough to forgive an imprecise finger, small enough that a card meant
// for open canvas beside a column is not swallowed by it - 220 was the
// second of those and not the first.
const COLUMN_SNAP_MARGIN = 90;
const CONNECTION_COLOR = '#8B5CF6';
// Padding around a connection's own bounding box, so the curve's bulge and
// the stroke width itself aren't clipped by the little Svg canvas each
// connection is drawn into.
const CONNECTION_PADDING = 24;
// A dragged card's own alignment guides, deliberately not the selection
// blue or the connection purple - a third colour on the board would be
// a fourth meaning to learn, so this borrows the one every design tool
// already uses for the same job.
const GUIDE_COLOR = '#FF3D9A';
// How close an edge has to land, in SCREEN points regardless of zoom -
// divided by canvasScale wherever it's actually compared, the same way
// every other on-screen distance in this file is (see COLUMN_SNAP_MARGIN's
// own use of canvasScale). A guide that only ever fired at one zoom level
// would read as broken at every other one.
const GUIDE_SNAP_DISTANCE = 6;

const documentsCollection = collection(db, 'documents');

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Same resize-then-compress every other image-picking flow in this app
// already goes through (PhotosScreen's own "+", StickerComposer) -
// duplicated rather than shared, per this app's established convention for
// small single-purpose helpers.
async function compressPickedImage(uri: string, width: number, height: number): Promise<string> {
  const MAX_DIMENSION = 1600;
  try {
    const longest = Math.max(width, height);
    let context = ImageManipulator.manipulate(uri);
    if (longest > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / longest;
      context = context.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return saved.uri;
  } catch {
    return uri;
  }
}

function newTextCard(index: number): BoardCard {
  const jitter = (index % 6) * 24;
  return {
    id: generateId(),
    text: '',
    type: 'paragraph',
    createdAt: Date.now(),
    x: WORLD_CENTER - DEFAULT_CARD_WIDTH / 2 + jitter,
    y: WORLD_CENTER - 60 + jitter,
    width: DEFAULT_CARD_WIDTH,
    color: STICKY_COLORS[index % STICKY_COLORS.length],
  };
}

function cardFromExistingBlock(block: Block, index: number): BoardCard {
  const jitter = (index % 6) * 24;
  return {
    ...block,
    x: WORLD_CENTER - DEFAULT_CARD_WIDTH / 2 + jitter,
    y: WORLD_CENTER - 60 + jitter,
    width: DEFAULT_CARD_WIDTH,
  };
}

// A document card always gets a fresh id, unlike file/photo cards which
// reuse the referenced record's own id - there's no Drive-dedup or
// usedInDocuments concern for a document reference (it's just a documentId
// pointer), so nothing stops the same document from being pinned to the
// board more than once.
function newDocumentCard(
  document: { id: string; title: string },
  preview: { text?: string; imageUri?: string },
  index: number
): BoardCard {
  const jitter = (index % 6) * 24;
  const card: BoardCard = {
    id: generateId(),
    text: '',
    type: 'document',
    createdAt: Date.now(),
    documentId: document.id,
    documentTitle: document.title,
    x: WORLD_CENTER - DEFAULT_CARD_WIDTH / 2 + jitter,
    y: WORLD_CENTER - 60 + jitter,
    width: DEFAULT_CARD_WIDTH,
  };
  if (preview.text) card.documentPreviewText = preview.text;
  if (preview.imageUri) card.documentPreviewImageUri = preview.imageUri;
  return card;
}

function fileIconFor(name: string): 'document-text-outline' | 'document-outline' {
  return name.toLowerCase().endsWith('.pdf') ? 'document-text-outline' : 'document-outline';
}

// A plain-text peek at a document's blocks, cached onto the card at
// add-time - not a real rendering of the editor's block types, just enough
// to tell what's in there before deciding to open it for real. Text-bearing
// block types show their text as-is; everything else gets a short
// bracketed tag rather than being silently dropped, so an image/file/link-
// heavy document doesn't preview as an empty page.
function blocksToPreviewText(blocks: Block[]): string {
  const TEXT_TYPES = new Set(['paragraph', 'bulleted', 'numbered', 'checkbox', undefined]);
  return blocks
    .map((b) => {
      const type = b.type;
      if (TEXT_TYPES.has(type) && b.text.trim()) return b.text;
      if (type === 'image') return `[Зображення${b.imageTitle ? ': ' + b.imageTitle : ''}]`;
      if (type === 'file') return `[Файл: ${b.fileTitle || b.fileName || ''}]`;
      if (type === 'link') return `[Посилання: ${b.linkTitle || b.linkSiteName || ''}]`;
      if (type === 'sketch') return '[Малюнок]';
      if (type === 'table') return '[Таблиця]';
      return null;
    })
    .filter((line): line is string => !!line)
    .join('\n');
}

function firstImageUri(blocks: Block[]): string | undefined {
  return blocks.find((b) => b.type === 'image' && b.imageUri)?.imageUri;
}

// A card's real rendered height, reported by its own onLayout (see
// DraggableCard's onMeasure). Falls back to the rough constant only for a
// card that hasn't been laid out yet - stacking a column by the constant
// is what made tall cards overflow their column and overlap each other.
function heightOf(card: BoardCard, heights: Map<string, number>): number {
  return heights.get(card.id) ?? APPROX_CARD_HEIGHT;
}

// A column's cards, top to bottom in their current vertical order - which
// is what makes dropping a card above another genuinely reorder them.
function columnMembers(cards: BoardCard[], columnId: string): BoardCard[] {
  // By index where there is one, and by drawn position where there is
  // not - a board written before cards carried an index still opens in
  // the order it was left in, and gains one the first time it is touched.
  return cards
    .filter((c) => c.columnId === columnId)
    .sort((a, b) => (a.order != null && b.order != null ? a.order - b.order : a.y - b.y));
}

function columnHeight(members: BoardCard[], heights: Map<string, number>): number {
  const filled = members.reduce((sum, card) => sum + heightOf(card, heights) + COLUMN_CARD_GAP, 0);
  return Math.max(COLUMN_MIN_HEIGHT, COLUMN_HEADER_HEIGHT + filled + COLUMN_PADDING);
}

// What a card looks like when it is compared with what was written down,
// and when it is written. A card in a COLUMN keeps the position it was
// last stored with: where it is actually drawn depends on heights this
// device measured for itself, and sending those makes two screens argue
// forever. A card that has just changed column is the exception - it has
// to carry its new place, or it stays written down in the old column.
function asStored(cards: BoardCard[], saved: BoardCard[]): BoardCard[] {
  const savedById = new Map(saved.map((card) => [card.id, card]));
  return cards.map((card) => {
    if (!card.columnId) return card;
    const previous = savedById.get(card.id);
    if (!previous || previous.columnId !== card.columnId) return card;
    return { ...card, x: previous.x, y: previous.y };
  });
}

// The column a card dropped at this point belongs to: the nearest one
// whose box the point is inside or within COLUMN_SNAP_MARGIN of. Nearest
// rather than first-match because with a margin that generous, two
// neighbouring columns' catch areas overlap.
function columnAtPoint(
  columns: BoardColumn[],
  cards: BoardCard[],
  heights: Map<string, number>,
  x: number,
  y: number,
  // The column this card is currently IN, if any. It gets no catch area
  // at all - the card has to be over its rectangle to stay, and is free
  // the moment it is outside. Every OTHER column keeps the margin.
  //
  // That asymmetry is the whole mechanism, and two attempts got it
  // backwards. A halo around the card's own column is a halo it has to
  // escape before it can go anywhere, so the bigger the magnet, the more
  // firmly a card is held by the place it is trying to leave. Catching
  // should be generous; holding on should not.
  homeColumnId?: string
): BoardColumn | undefined {
  let best: BoardColumn | undefined;
  let bestDistance = COLUMN_SNAP_MARGIN;
  for (const column of columns) {
    const margin = column.id === homeColumnId ? 0 : COLUMN_SNAP_MARGIN;
    const height = columnHeight(columnMembers(cards, column.id), heights);
    // Distance from the point to the column's rectangle - zero anywhere
    // inside it, so a card actually dropped in always wins.
    const dx = Math.max(column.x - x, 0, x - (column.x + COLUMN_WIDTH));
    const dy = Math.max(column.y - y, 0, y - (column.y + height));
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > margin) continue;
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = column;
    }
  }
  return best;
}

// A card in a column doesn't own its own position - the column stacks its
// members top to bottom, each below the real height of the one above it.
// Cards outside every column are left exactly where they were put.
//
// Returns the ORIGINAL array when nothing actually moved: this runs from
// onLayout, and a fresh array every time would re-render and re-save the
// board on every measurement.
function reflowColumns(
  cards: BoardCard[],
  columns: BoardColumn[],
  heights: Map<string, number>
): BoardCard[] {
  const columnIds = new Set(columns.map((c) => c.id));
  const slots = new Map<string, { x: number; y: number; order: number }>();
  for (const column of columns) {
    const members = columnMembers(cards, column.id);
    // Only a column NOTHING in which has been measured yet is left alone -
    // that is the board opening, where the saved positions are already
    // right and laying out against the fallback constant would visibly
    // yank every card for one frame. Once anything in the column has a
    // real height, a card that has not reported yet is placed against the
    // approximate one instead of stopping the whole column: a card just
    // dropped in would otherwise sit exactly where it fell, which is the
    // one moment it must not.
    if (members.length > 0 && members.every((card) => !heights.has(card.id))) continue;
    let y = column.y + COLUMN_HEADER_HEIGHT;
    members.forEach((card, index) => {
      slots.set(card.id, { x: column.x + COLUMN_PADDING, y, order: index });
      y += heightOf(card, heights) + COLUMN_CARD_GAP;
    });
  }
  let changed = false;
  const next = cards.map((card) => {
    const slot = slots.get(card.id);
    if (slot) {
      if (card.x === slot.x && card.y === slot.y && card.order === slot.order) return card;
      changed = true;
      return { ...card, ...slot };
    }
    // Pointing at a column that's since been deleted releases the card. The
    // key is dropped rather than set to undefined - Firestore rejects an
    // undefined field value outright.
    if (card.columnId && !columnIds.has(card.columnId)) {
      changed = true;
      return releaseFromColumn(card);
    }
    return card;
  });
  return changed ? next : cards;
}

function releaseFromColumn(card: BoardCard): BoardCard {
  const { columnId: _columnId, ...rest } = card;
  return rest;
}

// Where a connection meets each of its two cards: the middle of whichever
// vertical side faces the other card, so the line never has to cross back
// over a card to reach it. Recomputed on every render rather than stored,
// which is what lets dragging a card past its partner flip the routing.
// ANYTHING AN ARROW CAN END ON. A card or a piece of the board's own
// furniture - the arrow does not care which, and it must not: the user
// asked for shapes an arrow can reach and said in the same breath that
// this is not a new thing to store. It is not: a connection holds two
// ids, and an id is an id.
type BoardNode = { id: string; x: number; y: number; width: number; height: number };

// Picks LEFT/RIGHT or TOP/BOTTOM by whichever is the shorter real hop -
// the user's own ask: "лінії повинні вміти з'єднуватись не тільки збоку
// але й згори, в залежності від найкоротшого маршруту". Marked as a
// worklet so the SAME function serves both the resting curve (called
// from plain JS, below) and the live straight-line drag (called from
// LiveConnectionLine's own useAnimatedStyle) - one routing rule, not two
// copies that could drift apart.
//
// The "gap" on an axis is the real distance between the two boxes' EDGES
// on that axis, not their centres - two boxes that overlap in x but sit
// one above the other have a horizontal gap of zero or less, whatever
// their centres say, and the bigger of the two gaps is the pair of edges
// actually worth crossing.
function connectionEndpoints(
  fromX: number,
  fromY: number,
  fromWidth: number,
  fromHeight: number,
  toX: number,
  toY: number,
  toWidth: number,
  toHeight: number
) {
  'worklet';
  const fromRight = fromX + fromWidth;
  const fromBottom = fromY + fromHeight;
  const toRight = toX + toWidth;
  const toBottom = toY + toHeight;
  const hGap = Math.max(fromX, toX) - Math.min(fromRight, toRight);
  const vGap = Math.max(fromY, toY) - Math.min(fromBottom, toBottom);
  if (hGap >= vGap) {
    const fromIsLeft = fromX + fromWidth / 2 <= toX + toWidth / 2;
    return {
      x1: fromIsLeft ? fromRight : fromX,
      y1: fromY + fromHeight / 2,
      x2: fromIsLeft ? toX : toRight,
      y2: toY + toHeight / 2,
      vertical: false,
    };
  }
  const fromIsAbove = fromY + fromHeight / 2 <= toY + toHeight / 2;
  return {
    x1: fromX + fromWidth / 2,
    y1: fromIsAbove ? fromBottom : fromY,
    x2: toX + toWidth / 2,
    y2: fromIsAbove ? toY : toBottom,
    vertical: true,
  };
}

// A mindmap S-curve: control points pushed straight out from each end,
// sideways for a left/right connection or up-and-down for a top/bottom
// one - so the line always leaves and arrives at a right angle to the
// edge it's actually anchored on, whichever routing connectionEndpoints
// picked.
function curvePath(x1: number, y1: number, x2: number, y2: number, vertical: boolean): string {
  if (vertical) {
    const bend = Math.max(30, Math.abs(y2 - y1) / 2);
    const direction = y2 >= y1 ? 1 : -1;
    return `M ${x1} ${y1} C ${x1} ${y1 + bend * direction} ${x2} ${y2 - bend * direction} ${x2} ${y2}`;
  }
  const bend = Math.max(30, Math.abs(x2 - x1) / 2);
  const direction = x2 >= x1 ? 1 : -1;
  return `M ${x1} ${y1} C ${x1 + bend * direction} ${y1} ${x2 - bend * direction} ${y2} ${x2} ${y2}`;
}

// The straight rubber band a connect-drag trails behind the finger, drawn
// as one rotated View rather than an Svg: it has to follow the finger on
// the UI thread, and an Svg big enough to cover anywhere the finger might
// go is the whole 6000px world. A plain View takes a transform just as
// well and costs nothing when idle.
function ConnectDraftLine({
  startX,
  startY,
  endX,
  endY,
  visible,
}: {
  startX: SharedValue<number>;
  startY: SharedValue<number>;
  endX: SharedValue<number>;
  endY: SharedValue<number>;
  visible: SharedValue<boolean>;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const animatedStyle = useAnimatedStyle(() => {
    const dx = endX.value - startX.value;
    const dy = endY.value - startY.value;
    const length = Math.sqrt(dx * dx + dy * dy);
    return {
      opacity: visible.value ? 1 : 0,
      width: length,
      // Positioned by its midpoint, then rotated about its own centre -
      // which after that translation is exactly the line's midpoint.
      transform: [
        { translateX: (startX.value + endX.value) / 2 - length / 2 },
        { translateY: (startY.value + endY.value) / 2 - 1 },
        { rotateZ: `${Math.atan2(dy, dx)}rad` },
      ],
    };
  });
  return <Animated.View style={[styles.connectDraft, animatedStyle]} pointerEvents="none" />;
}

// One endpoint of a live connection: a card's position shared value plus
// whichever shared drag offsets currently apply to it, so the line tracks
// a card being dragged on its own, as part of a selection, or inside a
// column being moved.
type LiveEndpoint = {
  posX: SharedValue<number>;
  posY: SharedValue<number>;
  offsetX: SharedValue<number> | null;
  offsetY: SharedValue<number> | null;
  columnOffsetX: SharedValue<number> | null;
  columnOffsetY: SharedValue<number> | null;
  containerOffsetX: SharedValue<number> | null;
  containerOffsetY: SharedValue<number> | null;
  width: number;
  height: number;
};

// The version of a connection drawn while either of its cards is moving.
// Deliberately a straight rotated View rather than the resting state's
// Svg curve: the curve's canvas would have to be resized every frame to
// keep up with the endpoints, and a fixed one big enough for any drag
// distance runs into Android's own view-size limits. A straight line
// needs nothing but a transform, and the curve comes back the moment the
// card is dropped.
function LiveConnectionLine({ from, to }: { from: LiveEndpoint; to: LiveEndpoint }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const animatedStyle = useAnimatedStyle(() => {
    const fromX =
      from.posX.value + (from.offsetX?.value ?? 0) + (from.columnOffsetX?.value ?? 0) + (from.containerOffsetX?.value ?? 0);
    const fromY =
      from.posY.value + (from.offsetY?.value ?? 0) + (from.columnOffsetY?.value ?? 0) + (from.containerOffsetY?.value ?? 0);
    const toX =
      to.posX.value + (to.offsetX?.value ?? 0) + (to.columnOffsetX?.value ?? 0) + (to.containerOffsetX?.value ?? 0);
    const toY =
      to.posY.value + (to.offsetY?.value ?? 0) + (to.columnOffsetY?.value ?? 0) + (to.containerOffsetY?.value ?? 0);

    // Same routing rule the resting curve uses (connectionEndpoints,
    // marked 'worklet' for exactly this call), so the line doesn't jump
    // to a different pair of edges the moment the card is dropped.
    const { x1, y1, x2, y2 } = connectionEndpoints(fromX, fromY, from.width, from.height, toX, toY, to.width, to.height);

    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    return {
      width: length,
      transform: [
        { translateX: (x1 + x2) / 2 - length / 2 },
        { translateY: (y1 + y2) / 2 - 1 },
        { rotateZ: `${Math.atan2(dy, dx)}rad` },
      ],
    };
  });
  return <Animated.View style={[styles.connectDraft, animatedStyle]} pointerEvents="none" />;
}

// The two dashed alignment guides - see GUIDE_COLOR. Drawn as a thin
// bordered View spanning the whole world, moved into place with a
// transform, for the same reason LiveConnectionLine is a straight View
// rather than an Svg: a fixed canvas big enough for any position runs
// into Android's own view-size limits, and a transform needs neither a
// resize nor a re-measure to follow the drag. Mounted once at the board
// level, never per card - only one card is ever dragged at a time, so
// there is only ever one pair of lines to show.
function AlignmentGuides({
  guideVX,
  guideVVisible,
  guideHY,
  guideHVisible,
}: {
  guideVX: SharedValue<number>;
  guideVVisible: SharedValue<boolean>;
  guideHY: SharedValue<number>;
  guideHVisible: SharedValue<boolean>;
}) {
  const styles = useStyles(makeStyles);
  const vStyle = useAnimatedStyle(() => ({
    opacity: guideVVisible.value ? 1 : 0,
    transform: [{ translateX: guideVX.value }],
  }));
  const hStyle = useAnimatedStyle(() => ({
    opacity: guideHVisible.value ? 1 : 0,
    transform: [{ translateY: guideHY.value }],
  }));
  return (
    <>
      <Animated.View style={[styles.guideLineV, vStyle]} pointerEvents="none" />
      <Animated.View style={[styles.guideLineH, hStyle]} pointerEvents="none" />
    </>
  );
}

// A kanban lane, dragged by its own header. Same position architecture as
// DraggableCard (the view's left/top pinned at 0, everything on an animated
// transform), and the same shared-offset trick group drags use: this
// column writes columnOffsetX/Y, and every card inside it reads the same
// values, so the lane and its contents move together in one paint.
function DraggableColumn({
  column,
  memberCount,
  height,
  isDragging,
  isCatching,
  canvasScale,
  canvasPanGesture,
  columnOffsetX,
  columnOffsetY,
  onDragStart,
  onDragEnd,
  onRename,
  onDelete,
}: {
  column: BoardColumn;
  memberCount: number;
  height: number;
  isDragging: boolean;
  // A card is being carried over this column right now: it lights up to
  // say it will catch, rather than the drop being a surprise.
  isCatching: boolean;
  canvasScale: SharedValue<number>;
  canvasPanGesture: ReturnType<typeof Gesture.Pan>;
  columnOffsetX: SharedValue<number>;
  columnOffsetY: SharedValue<number>;
  onDragStart: (id: string) => void;
  onDragEnd: (id: string, dx: number, dy: number) => void;
  onRename: (column: BoardColumn) => void;
  onDelete: (column: BoardColumn) => void;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const posX = useSharedValue(column.x);
  const posY = useSharedValue(column.y);
  const reportedX = useSharedValue(column.x);
  const reportedY = useSharedValue(column.y);

  useLayoutEffect(() => {
    if (column.x === reportedX.value && column.y === reportedY.value) return;
    reportedX.value = column.x;
    reportedY.value = column.y;
    posX.value = column.x;
    posY.value = column.y;
    columnOffsetX.value = 0;
    columnOffsetY.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column.x, column.y]);

  const panGesture = Gesture.Pan()
    .blocksExternalGesture(canvasPanGesture)
    .onStart(() => {
      runOnJS(onDragStart)(column.id);
    })
    .onChange((e) => {
      columnOffsetX.value += e.changeX / canvasScale.value;
      columnOffsetY.value += e.changeY / canvasScale.value;
    })
    .onEnd(() => {
      runOnJS(onDragEnd)(column.id, columnOffsetX.value, columnOffsetY.value);
    });

  const tapGesture = Gesture.Tap().onEnd(() => {
    runOnJS(onRename)(column);
  });

  const longPressGesture = Gesture.LongPress()
    .minDuration(500)
    .onStart(() => {
      runOnJS(onDelete)(column);
    });

  const headerGesture = Gesture.Race(panGesture, tapGesture, longPressGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: posX.value + (isDragging ? columnOffsetX.value : 0) },
      { translateY: posY.value + (isDragging ? columnOffsetY.value : 0) },
    ],
  }));

  return (
    // box-none so only the header takes touches - the rest of the lane
    // stays transparent to the canvas's own pan, and the cards sitting on
    // top of it keep their own drags.
    <Animated.View
      style={[styles.column, isCatching && styles.columnCatching, { height }, animatedStyle]}
      pointerEvents="box-none"
    >
      <GestureDetector gesture={headerGesture}>
        <View style={styles.columnHeader}>
          <View style={styles.columnTitleWrap}>
            <Text style={styles.columnTitle} numberOfLines={1}>
              {column.title}
            </Text>
          </View>
          <Text style={styles.columnCount}>{memberCount}</Text>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

// A free-standing frame - see BoardContainer in types.ts. Built the same
// way DraggableColumn is (a header that alone takes touches, everything
// else box-none so the canvas and whatever sits on top keep their own
// gestures) with two real differences: the fill is genuinely transparent
// (a column's is a translucent tint) and it carries its own resize grip,
// because its size is stored rather than derived from its members.
function DraggableContainer({
  container,
  posX,
  posY,
  isDragging,
  dimmed,
  locked,
  canvasScale,
  canvasPanGesture,
  containerOffsetX,
  containerOffsetY,
  onDragStart,
  onDragEnd,
  onRename,
  onDelete,
  onResize,
  onStepFontSize,
}: {
  container: BoardContainer;
  // From the board's own position registry, same as a card/shape - so a
  // connection ending on a container can read its live position too
  // (see liveEndpointFor).
  posX: SharedValue<number>;
  posY: SharedValue<number>;
  isDragging: boolean;
  // True while isolation is active and this container is OUTSIDE the
  // isolated chain - faded and untouchable, same treatment a card/shape
  // gets (see their own `dimmed` prop).
  dimmed: boolean;
  // True while this container's own BoardLayer is locked - blocks drag,
  // resize, rename and delete, but never visibility (see BoardLayer's
  // own comment on why lock and hide are two different things).
  locked: boolean;
  canvasScale: SharedValue<number>;
  canvasPanGesture: ReturnType<typeof Gesture.Pan>;
  containerOffsetX: SharedValue<number>;
  containerOffsetY: SharedValue<number>;
  onDragStart: (id: string) => void;
  onDragEnd: (id: string, dx: number, dy: number) => void;
  onRename: (container: BoardContainer) => void;
  onDelete: (container: BoardContainer) => void;
  onResize: (id: string, width: number, height: number) => void;
  onStepFontSize: (container: BoardContainer, dir: 1 | -1) => void;
}) {
  const styles = useStyles(makeStyles);
  const reportedX = useSharedValue(container.x);
  const reportedY = useSharedValue(container.y);

  useLayoutEffect(() => {
    if (container.x === reportedX.value && container.y === reportedY.value) return;
    reportedX.value = container.x;
    reportedY.value = container.y;
    posX.value = container.x;
    posY.value = container.y;
    containerOffsetX.value = 0;
    containerOffsetY.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container.x, container.y]);

  const panGesture = Gesture.Pan()
    .enabled(!locked)
    .blocksExternalGesture(canvasPanGesture)
    .onStart(() => {
      runOnJS(onDragStart)(container.id);
    })
    .onChange((e) => {
      containerOffsetX.value += e.changeX / canvasScale.value;
      containerOffsetY.value += e.changeY / canvasScale.value;
    })
    .onEnd(() => {
      runOnJS(onDragEnd)(container.id, containerOffsetX.value, containerOffsetY.value);
    });

  const tapGesture = Gesture.Tap()
    .enabled(!locked)
    .onEnd(() => {
      runOnJS(onRename)(container);
    });

  const longPressGesture = Gesture.LongPress()
    .enabled(!locked)
    .minDuration(500)
    .onStart(() => {
      runOnJS(onDelete)(container);
    });

  const headerGesture = Gesture.Race(panGesture, tapGesture, longPressGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: posX.value + (isDragging ? containerOffsetX.value : 0) },
      { translateY: posY.value + (isDragging ? containerOffsetY.value : 0) },
    ],
  }));

  // The resize grip - same pattern DraggableShape's own grip uses: a
  // live local width/height while the finger is down, committed once on
  // release rather than on every frame.
  const [live, setLive] = useState<{ width: number; height: number } | null>(null);
  const resizeBase = useRef({ width: container.width, height: container.height });
  const width = live?.width ?? container.width;
  const height = live?.height ?? container.height;
  const resizeGesture = Gesture.Pan()
    .enabled(!locked)
    .blocksExternalGesture(canvasPanGesture)
    .onStart(() => {
      resizeBase.current = { width, height };
    })
    .onChange((e) => {
      setLive({
        width: clampContainerWidth(resizeBase.current.width + e.translationX / canvasScale.value),
        height: clampContainerHeight(resizeBase.current.height + e.translationY / canvasScale.value),
      });
    })
    .onEnd(() => {
      const next = live;
      setLive(null);
      if (next) runOnJS(onResize)(container.id, next.width, next.height);
    })
    .runOnJS(true);

  return (
    <Animated.View
      style={[styles.frame, { width, height, opacity: dimmed ? 0.28 : 1 }, animatedStyle]}
      pointerEvents={dimmed ? 'none' : 'box-none'}
    >
      <View style={[styles.frameLabelRow, { width }]}>
        <GestureDetector gesture={headerGesture}>
          <View style={styles.frameLabel}>
            <Text
              style={[styles.frameLabelText, { fontSize: container.fontSize ?? SHAPE_LABEL_SIZE_DEFAULT }]}
              numberOfLines={1}
            >
              {container.title}
            </Text>
          </View>
        </GestureDetector>
        {/* The user's own ask: a NUMBER to compare sizes by, not a guess
            by eye - see textSizeStepLabel. A separate pill, never nested
            inside the label's own GestureDetector - the label's Pan has
            no minimum distance (see headerGesture), so a button living
            inside that same touch area would lose its own tap to the
            drag every time. */}
        <View style={styles.frameSizeStepper}>
          <Pressable hitSlop={6} onPress={() => onStepFontSize(container, -1)}>
            <Ionicons name="remove" size={13} color="#fff" />
          </Pressable>
          <Text style={styles.frameSizeStepperText}>
            {textSizeStepLabel(container.fontSize ?? SHAPE_LABEL_SIZE_DEFAULT)}
          </Text>
          <Pressable hitSlop={6} onPress={() => onStepFontSize(container, 1)}>
            <Ionicons name="add" size={13} color="#fff" />
          </Pressable>
        </View>
        {/* A long-press on the label already deletes (same as a column's
            header) - added here too, visibly, because "не бачу
            механізма їх видалення" is exactly what an invisible-only
            affordance earns. */}
        <Pressable hitSlop={6} style={styles.frameDeleteButton} onPress={() => onDelete(container)}>
          <Ionicons name="trash-outline" size={13} color="#fff" />
        </Pressable>
      </View>
      <GestureDetector gesture={resizeGesture}>
        <View style={styles.cardGrip}>
          <Ionicons name="resize-outline" size={13} color="#fff" />
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

type DraggableCardProps = {
  card: BoardCard;
  // This card's live world position. Owned by BoardScreen (see
  // cardPositions) rather than created here, so the connection lines can
  // read it while a drag is in flight - the card itself still treats it
  // exactly as it did when it was local state.
  posX: SharedValue<number>;
  posY: SharedValue<number>;
  canvasScale: SharedValue<number>;
  canvasPanGesture: ReturnType<typeof Gesture.Pan>;
  isDragging: boolean;
  isSelected: boolean;
  // True while isolation is active and this card is outside the
  // isolated chain - faded and untouchable until isolation ends.
  dimmed: boolean;
  // True while this card is being dragged AND it's part of a multi-card
  // selection - in that case the drag moves the whole selection together
  // (via the shared groupOffsetX/Y) instead of just this one card.
  isGroupDrag: boolean;
  groupOffsetX: SharedValue<number>;
  groupOffsetY: SharedValue<number>;
  // True while the column this card sits in is itself being dragged - the
  // card then rides the column's own live offset, so the lane and its
  // contents move as one piece instead of the cards catching up on drop.
  followsColumnDrag: boolean;
  columnOffsetX: SharedValue<number>;
  columnOffsetY: SharedValue<number>;
  // Same idea, for a BoardContainer this card currently sits inside - a
  // column and a container can never both apply to a card (only a
  // column reads columnId, only geometry decides a container's members,
  // and a card is never dragged by two frames at once), so the two
  // offsets simply add - only one is ever non-zero for a given card.
  followsContainerDrag: boolean;
  containerOffsetX: SharedValue<number>;
  containerOffsetY: SharedValue<number>;
  // Every card's bounds, and the board's own guide shared values - see
  // GUIDE_COLOR. Only read while THIS card is the one being dragged
  // (isGroupDrag false); a card's own entry is skipped by id.
  allCardBounds: { id: string; x: number; y: number; width: number; height: number }[];
  guideVX: SharedValue<number>;
  guideVVisible: SharedValue<boolean>;
  guideHY: SharedValue<number>;
  guideHVisible: SharedValue<boolean>;
  // False while the canvas is in 'connect' mode: a drag starting on a card
  // has to reach the canvas's own connect gesture to draw a link, and this
  // card's Pan would otherwise win that touch (it blocksExternalGesture)
  // and just move the card instead.
  dragEnabled: boolean;
  // Reports this card's real rendered height, which is what a column
  // stacks by. Layout is measured before the canvas's own scale transform
  // is applied, so this is already in world units.
  onMeasure: (id: string, height: number) => void;
  onDragStart: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  // Where this card is, mid-drag, every few points of travel - what tells
  // the board which column would catch it right now.
  onHover: (id: string, x: number, y: number) => void;
  onGroupDragEnd: (dx: number, dy: number) => void;
  onTap: (card: BoardCard) => void;
  onLongPress: (card: BoardCard) => void;
  onResize: (id: string, width: number) => void;
  // The canvas's own "hold to reach for the marquee". A card's hold has
  // to beat it - see the card's longPressGesture.
  canvasHoldGesture: ReturnType<typeof Gesture.LongPress>;
};

// One card's own drag.
//
// The position lives in `posX`/`posY` shared values and NOWHERE else - the
// view's `left`/`top` stay pinned at 0 forever and the whole world offset
// rides on the animated transform. That's the load-bearing decision here,
// arrived at after two failed attempts at the "jitter on release" bug:
// splitting a card's position across a layout prop (`left`/`top`, which
// travels JS render -> shadow tree -> native commit) AND an animated
// transform (which Reanimated writes straight to the view on the UI thread)
// means the two halves land in different frames. Every "swap the offset
// into the base position" scheme therefore had a 1-2 frame window showing
// either base+offset+offset (a jump of exactly the drag distance) or
// base+0 (a snap back to where the drag started) - which is precisely what
// the jitter was. One value, one pipeline, no swap, no window.
//
// React state is then only a persistence concern: `onDragEnd` reports the
// final position up so it reaches Firestore, and the `card.x`/`card.y`
// props coming back down are deliberately ignored unless they differ from
// what this card last reported (i.e. a genuinely external change), so a
// re-render can never fight the gesture.
//
// `canvasScale` is read inside the worklet so a drag still tracks the
// finger 1:1 while the canvas is pinch-zoomed. A Tap is raced against the
// Pan so a quick tap (edit a sticky's text) and a real drag never fight.
function DraggableCard({
  card,
  posX,
  posY,
  canvasScale,
  canvasPanGesture,
  isDragging,
  isSelected,
  dimmed,
  isGroupDrag,
  groupOffsetX,
  groupOffsetY,
  followsColumnDrag,
  columnOffsetX,
  columnOffsetY,
  followsContainerDrag,
  containerOffsetX,
  containerOffsetY,
  allCardBounds,
  guideVX,
  guideVVisible,
  guideHY,
  guideHVisible,
  dragEnabled,
  onMeasure,
  onDragStart,
  onDragEnd,
  onHover,
  onGroupDragEnd,
  onTap,
  onLongPress,
  onResize,
  canvasHoldGesture,
}: DraggableCardProps) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  // The last position this card itself put into the parent's state. Used
  // only to tell "our own drag echoing back" (ignore) apart from a real
  // external move (adopt).
  // An image card whose local file is not here - a card made on another
  // device, or one whose bytes the ninety-day sweep took - fetches it
  // back from Drive. The board was the one place that never did: it put
  // pictures ON the Drive and never asked for them back.
  const { status: imageStatus, source: imageSource } = useAttachmentSource(
    (card.type ?? 'paragraph') === 'image' ? card.imageUri : undefined,
    card.driveFileId,
    false
  );

  const reportedX = useSharedValue(card.x);
  const reportedY = useSharedValue(card.y);

  useLayoutEffect(() => {
    if (card.x === reportedX.value && card.y === reportedY.value) return;
    reportedX.value = card.x;
    reportedY.value = card.y;
    posX.value = card.x;
    posY.value = card.y;
    // A group drag this card took part in (as a non-dragged, merely
    // selected sibling) only ever moves it via groupOffsetX/Y, never posX/
    // posY directly - reset that shared offset back to 0 in the same
    // layout effect that adopts the new base position, so the two changes
    // land in the same paint. Redundant (and harmless) for a plain solo
    // drag, where the offset was never touched to begin with.
    groupOffsetX.value = 0;
    groupOffsetY.value = 0;
    // Same for a column drag this card rode along on - the committed
    // position already includes that offset, so it has to go back to zero
    // in the very paint that adopts it.
    columnOffsetX.value = 0;
    columnOffsetY.value = 0;
    // And the same again for a container this card rode along in - see
    // followsContainerDrag's own comment.
    containerOffsetX.value = 0;
    containerOffsetY.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.x, card.y]);

  // blocksExternalGesture: RNGH's Gesture API treats gestures in separate
  // (even nested) GestureDetectors as fully independent, so without this
  // the canvas's own Pan (see BoardScreen) also recognizes movement on the
  // very same touch that is dragging a card, and both move at once. An
  // expanded document card drags exactly like a collapsed one - only the
  // tap-to-edit interaction differs (see the selection bar's "Редагувати"
  // button in BoardScreen, reached via long-press) now that there's no
  // in-card button whose own gesture needed to win against this one.
  const hoverReportedX = useSharedValue(0);
  const hoverReportedY = useSharedValue(0);
  // The width the corner grip is asking for, while it is held. Kept in
  // the card rather than in the board's state so a resize re-renders one
  // card per frame instead of every card on the canvas.
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const resizeBase = useRef(0);
  // This card's own size, purely for the alignment guides below - a
  // separate name from the render's own `cardWidth` further down (same
  // expression) because that one is declared after this gesture, and a
  // worklet closes over whatever is already in scope where it's built.
  const cardWidthForGuides = liveWidth ?? widthInColumn(card);
  const cardHeightForGuides = allCardBounds.find((b) => b.id === card.id)?.height ?? APPROX_CARD_HEIGHT;
  const panGesture = Gesture.Pan()
    .enabled(dragEnabled)
    .blocksExternalGesture(canvasPanGesture)
    .onStart(() => {
      runOnJS(onDragStart)(card.id);
    })
    // onChange (per-event delta) rather than onUpdate (cumulative
    // translation) - the position accumulates in place, so there's no
    // separate "drag start" baseline to capture or reconcile afterwards.
    .onChange((e) => {
      if (isGroupDrag) {
        groupOffsetX.value += e.changeX / canvasScale.value;
        groupOffsetY.value += e.changeY / canvasScale.value;
      } else {
        posX.value += e.changeX / canvasScale.value;
        posY.value += e.changeY / canvasScale.value;
        // Told to JS only every few points of travel: it is the answer to
        // "which column would catch this", and asking that on every frame
        // of a drag costs far more than it is worth.
        if (
          Math.abs(posX.value - hoverReportedX.value) > 8 ||
          Math.abs(posY.value - hoverReportedY.value) > 8
        ) {
          hoverReportedX.value = posX.value;
          hoverReportedY.value = posY.value;
          runOnJS(onHover)(card.id, posX.value, posY.value);
        }
        // ALIGNMENT GUIDES - entirely on this thread, no runOnJS: there
        // is nothing here JS needs to decide, only two shared values to
        // set. Every other card's LEFT, CENTRE and RIGHT edge (and TOP/
        // MIDDLE/BOTTOM for the other axis) is compared against this
        // card's own three; the closest match within GUIDE_SNAP_DISTANCE
        // (in screen points, so divided by the live zoom) wins, and only
        // one line per axis is ever shown - the same restraint a real
        // design tool's guides use.
        const threshold = GUIDE_SNAP_DISTANCE / canvasScale.value;
        const myLeft = posX.value;
        const myRight = posX.value + cardWidthForGuides;
        const myCenterX = posX.value + cardWidthForGuides / 2;
        const myTop = posY.value;
        const myBottom = posY.value + cardHeightForGuides;
        const myCenterY = posY.value + cardHeightForGuides / 2;
        let bestVDistance = threshold;
        let bestVX: number | null = null;
        let bestHDistance = threshold;
        let bestHY: number | null = null;
        for (let i = 0; i < allCardBounds.length; i++) {
          const other = allCardBounds[i];
          if (other.id === card.id) continue;
          const oLeft = other.x;
          const oRight = other.x + other.width;
          const oCenterX = other.x + other.width / 2;
          const oTop = other.y;
          const oBottom = other.y + other.height;
          const oCenterY = other.y + other.height / 2;
          for (const mx of [myLeft, myCenterX, myRight]) {
            for (const ox of [oLeft, oCenterX, oRight]) {
              const d = Math.abs(mx - ox);
              if (d < bestVDistance) {
                bestVDistance = d;
                bestVX = ox;
              }
            }
          }
          for (const my of [myTop, myCenterY, myBottom]) {
            for (const oy of [oTop, oCenterY, oBottom]) {
              const d = Math.abs(my - oy);
              if (d < bestHDistance) {
                bestHDistance = d;
                bestHY = oy;
              }
            }
          }
        }
        if (bestVX !== null) {
          guideVX.value = bestVX;
          guideVVisible.value = true;
        } else {
          guideVVisible.value = false;
        }
        if (bestHY !== null) {
          guideHY.value = bestHY;
          guideHVisible.value = true;
        } else {
          guideHVisible.value = false;
        }
      }
    })
    .onEnd(() => {
      guideVVisible.value = false;
      guideHVisible.value = false;
      if (isGroupDrag) {
        runOnJS(onGroupDragEnd)(groupOffsetX.value, groupOffsetY.value);
      } else {
        reportedX.value = posX.value;
        reportedY.value = posY.value;
        runOnJS(onDragEnd)(card.id, posX.value, posY.value);
      }
    });

  const tapGesture = Gesture.Tap().onEnd(() => {
    runOnJS(onTap)(card);
  });

  // Holding a card picks THAT card - which is what raises the bar of
  // things to do with it, and the grip on a picture's corner.
  //
  // It has to block the canvas's own hold, and it has to be no slower.
  // The canvas reaches for the marquee after 350ms and the card waited
  // 500, in a detector of its own that knows nothing about it - so a
  // hold on a card put the board into marquee mode instead, and the only
  // way left to pick one card was to draw a box around it.
  const longPressGesture = Gesture.LongPress()
    .minDuration(350)
    // A hand is never perfectly still - the same allowance the canvas's
    // own hold makes.
    .maxDistance(10)
    .blocksExternalGesture(canvasHoldGesture, canvasPanGesture)
    .onStart(() => {
      runOnJS(onLongPress)(card);
    });

  const gesture = Gesture.Race(panGesture, tapGesture, longPressGesture);

  // Two shared offsets can apply on top of this card's own position: the
  // group-drag one (a selected sibling is being dragged) and the column
  // one (the column this card sits in is being dragged). Both work the
  // same way - the thing actually under the finger writes the offset,
  // everything moving with it reads the same value.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          posX.value +
          (isSelected ? groupOffsetX.value : 0) +
          (followsColumnDrag ? columnOffsetX.value : 0) +
          (followsContainerDrag ? containerOffsetX.value : 0),
      },
      {
        translateY:
          posY.value +
          (isSelected ? groupOffsetY.value : 0) +
          (followsColumnDrag ? columnOffsetY.value : 0) +
          (followsContainerDrag ? containerOffsetY.value : 0),
      },
    ],
  }));

  const type = card.type ?? 'paragraph';
  const cardWidth = liveWidth ?? widthInColumn(card);
  // THE SHAPE THE PICTURE IS ACTUALLY IN.
  //
  // Read off the file, never stored: it is a property of the picture,
  // and a number two devices each recompute and write back is how the
  // board learnt to argue with itself once already. Undefined until the
  // file answers, and the fixed window is what is drawn until then, so
  // a card never has no height at all.
  const [naturalAspect, setNaturalAspect] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!card.imageNatural || !imageSource) return;
    let alive = true;
    Image.getSize(
      imageSource,
      (w, h) => {
        if (alive && w > 0 && h > 0) setNaturalAspect(h / w);
      },
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [card.imageNatural, imageSource]);
  const pictureHeight =
    card.imageNatural && naturalAspect
      ? Math.round((cardWidth - CARD_IMAGE_PADDING * 2) * naturalAspect)
      : cardImageHeight(cardWidth);
  // Every card kind can be made bigger, not just a picture - a sticky
  // note's text or a document's preview reads just as well wider. In a
  // column every card takes the column's width, so there is nothing to
  // drag there.
  const resizable = isSelected && !card.columnId;
  // blocksExternalGesture for the same reason the card's own drag has it:
  // nested detectors are independent, so without it the card would move
  // while its corner is being pulled.
  const resizeGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .blocksExternalGesture(panGesture, canvasPanGesture)
    .onBegin(() => {
      resizeBase.current = widthInColumn(card);
    })
    // Divided by the canvas scale so the corner tracks the finger 1:1
    // however far the board is zoomed - the same rule the drag follows.
    .onUpdate((e) => setLiveWidth(clampCardWidth(resizeBase.current + e.translationX / canvasScale.value)))
    .onFinalize((e) => {
      const next = clampCardWidth(resizeBase.current + e.translationX / canvasScale.value);
      onResize(card.id, next);
      setLiveWidth(null);
    });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        onLayout={(e) => onMeasure(card.id, e.nativeEvent.layout.height)}
        style={[
          styles.card,
          // A card in a column is drawn at the column's width, whatever
          // its own is - see widthInColumn.
          { width: cardWidth },
          // A plain (non-animated) style, not part of useAnimatedStyle -
          // isDragging only flips twice per drag (start/end), not per
          // frame, so it doesn't need to live on the UI thread. Elevation
          // is Android's own stacking mechanism (zIndex alone isn't always
          // enough there for sibling Views to reorder above one another).
          isDragging && styles.cardDragging,
          isSelected && styles.cardSelected,
          animatedStyle,
          dimmed && { opacity: 0.28 },
        ]}
        pointerEvents={dimmed ? 'none' : 'auto'}
      >
        {type === 'document' ? (
          <View style={styles.refCard}>
            {!card.documentExpanded &&
              (card.documentPreviewImageUri ? (
                <Image source={{ uri: card.documentPreviewImageUri }} style={styles.refThumb} resizeMode="cover" resizeMethod="resize" />
              ) : (
                <View style={[styles.refThumb, styles.refThumbPlaceholder]}>
                  <Ionicons name="document-text-outline" size={22} color="#6B7280" />
                </View>
              ))}
            <Text style={styles.refLabel} numberOfLines={card.documentExpanded ? undefined : 2}>
              {card.documentTitle || 'Без назви'}
            </Text>
            {!!card.documentPreviewText && (
              <Text style={styles.documentPreviewText} numberOfLines={card.documentExpanded ? undefined : 4}>
                {card.documentPreviewText}
              </Text>
            )}
          </View>
        ) : type === 'paragraph' ? (
          <View
            style={[
              styles.stickyCard,
              { backgroundColor: mutedForTheme(card.color ?? STICKY_COLORS[0], theme, STICKY_MUTE, theme.canvas.card) },
            ]}
          >
            <Text style={styles.stickyText} numberOfLines={6}>
              {card.text || 'Порожня картка'}
            </Text>
          </View>
        ) : type === 'image' ? (
          card.imageBare ? (
            imageSource ? (
              <Image
                source={{ uri: imageSource }}
                style={[styles.refThumbBare, { height: pictureHeight }]}
                resizeMode="cover" resizeMethod="resize"
              />
            ) : (
              <View style={[styles.refThumbBare, styles.refThumbPlaceholder, { height: pictureHeight }]}>
                {imageStatus === 'restoring' ? (
                  <ActivityIndicator color="#9CA3AF" />
                ) : (
                  <Ionicons name="image-outline" size={22} color="#9CA3AF" />
                )}
              </View>
            )
          ) : (
            <View style={styles.refCard}>
              {imageSource ? (
                <Image
                  source={{ uri: imageSource }}
                  style={[styles.refThumb, { height: pictureHeight }]}
                  resizeMode="cover" resizeMethod="resize"
                />
              ) : (
                <View style={[styles.refThumb, styles.refThumbPlaceholder, { height: pictureHeight }]}>
                  {imageStatus === 'restoring' ? (
                    <ActivityIndicator color="#9CA3AF" />
                  ) : (
                    <Ionicons name="image-outline" size={22} color="#9CA3AF" />
                  )}
                </View>
              )}
              <Text style={styles.refLabel} numberOfLines={2}>
                {card.imageTitle || 'Без назви'}
              </Text>
            </View>
          )
        ) : type === 'file' ? (
          <View style={styles.refCard}>
            <View style={[styles.refThumb, styles.refThumbPlaceholder]}>
              <Ionicons name={fileIconFor(card.fileName ?? '')} size={22} color="#6B7280" />
            </View>
            <Text style={styles.refLabel} numberOfLines={2}>
              {card.fileTitle || card.fileName || 'Файл'}
            </Text>
          </View>
        ) : type === 'link' ? (
          <View style={styles.refCard}>
            {card.linkImageUrl ? (
              <Image source={{ uri: card.linkImageUrl }} style={styles.refThumb} resizeMode="cover" resizeMethod="resize" />
            ) : (
              <View style={[styles.refThumb, styles.refThumbPlaceholder]}>
                <Ionicons name="link-outline" size={22} color="#9CA3AF" />
              </View>
            )}
            <Text style={styles.refLabel} numberOfLines={2}>
              {card.linkTitle || card.linkSiteName || 'Посилання'}
            </Text>
          </View>
        ) : type === 'dbRow' ? (
          // A row of a user-created database, rendered live from that
          // database through the same card its own list and its document
          // block use (see CustomRowBlockCard) - a rename there shows up
          // here without the board storing anything but the row's id.
          <View style={styles.dbRowCard} pointerEvents="none">
            <CustomRowBlockCard
              databaseId={card.dbRowDatabaseId}
              rowId={card.id}
              fallbackTitle={card.dbRowTitle}
              tags={[]}
              onOpen={() => {}}
            />
          </View>
        ) : null}

        {resizable && (
          <GestureDetector gesture={resizeGesture}>
            <View style={styles.cardGrip}>
              <Ionicons name="resize-outline" size={13} color="#fff" />
            </View>
          </GestureDetector>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

// A piece of the board's FURNITURE, drawn. See BoardShape in types.ts
// for why this is not a card: it is decoration, it never becomes a
// block, and keeping it out of `cards` is what makes that true by
// construction instead of by everyone remembering.
function ShapeBody({
  shape,
  width,
  height,
  stroke,
  fill,
  ink,
}: {
  shape: BoardShape;
  width: number;
  height: number;
  stroke: string;
  // 'none', or the same colour as the outline at a fraction of it - see
  // shapeFillFor. Kept as one prop rather than recomputed per element so
  // every element in one shape agrees.
  fill: string;
  ink: string;
}) {
  const styles = useStyles(makeStyles);
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  // Half the stroke sits outside the path, so every shape is drawn
  // inset by that much or its outline is clipped by its own box.
  const i = SHAPE_STROKE / 2;
  const fontSize = shape.fontSize ?? (shape.kind === 'text' ? SHAPE_TEXT_SIZE_DEFAULT : SHAPE_LABEL_SIZE_DEFAULT);
  return (
    <>
      {shape.kind !== 'text' && (
        <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
          {(shape.kind === 'rect' || shape.kind === 'square') && (
            <Rect
              x={i}
              y={i}
              width={w - SHAPE_STROKE}
              height={h - SHAPE_STROKE}
              rx={10}
              fill={fill}
              stroke={stroke}
              strokeWidth={SHAPE_STROKE}
            />
          )}
          {(shape.kind === 'ellipse' || shape.kind === 'circle') && (
            <Ellipse
              cx={w / 2}
              cy={h / 2}
              rx={w / 2 - i}
              ry={h / 2 - i}
              fill={fill}
              stroke={stroke}
              strokeWidth={SHAPE_STROKE}
            />
          )}
          {shape.kind === 'triangle' && (
            <Polygon
              points={`${w / 2},${i} ${w - i},${h - i} ${i},${h - i}`}
              fill={fill}
              stroke={stroke}
              strokeWidth={SHAPE_STROKE}
              strokeLinejoin="round"
            />
          )}
          {shape.kind === 'diamond' && (
            <Polygon
              points={`${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}`}
              fill={fill}
              stroke={stroke}
              strokeWidth={SHAPE_STROKE}
              strokeLinejoin="round"
            />
          )}
        </Svg>
      )}
      {/* The words sit in the middle of whatever was drawn - and for
          'text' they ARE the whole thing. Padded well in from the edge:
          a triangle and a diamond have very little room at their points,
          and text that runs into the outline reads as a mistake. */}
      <View style={[styles.shapeTextWrap, shape.kind === 'text' && styles.shapeTextWrapBare]}>
        <Text
          style={[
            styles.shapeText,
            { color: shape.kind === 'text' ? shape.color ?? ink : ink, fontSize },
            shape.kind === 'text' && styles.shapeTextLoose,
          ]}
        >
          {shape.text || (shape.kind === 'text' ? 'Текст' : '')}
        </Text>
      </View>
    </>
  );
}

// One shape's own drag, built exactly like a card's - see DraggableCard
// for why the position lives in shared values and nowhere else.
function DraggableShape({
  shape,
  isSelected,
  posX,
  posY,
  onDragStart,
  dragEnabled,
  canvasScale,
  canvasPanGesture,
  canvasHoldGesture,
  onTap,
  onLongPress,
  onDragEnd,
  onResize,
  followsContainerDrag,
  containerOffsetX,
  containerOffsetY,
  dimmed,
}: {
  shape: BoardShape;
  isSelected: boolean;
  // From the board's own registry, the same one the cards use - so an
  // arrow ending on this shape follows it live while it is dragged.
  posX: SharedValue<number>;
  posY: SharedValue<number>;
  onDragStart: (id: string) => void;
  // True while a BoardContainer this shape currently sits inside is
  // itself being dragged - same shared-offset trick DraggableCard uses
  // for a column (see followsColumnDrag there), generalised to a frame
  // that can hold either kind of item.
  followsContainerDrag: boolean;
  containerOffsetX: SharedValue<number>;
  containerOffsetY: SharedValue<number>;
  // True while isolation is active and this shape is outside the
  // isolated chain.
  dimmed: boolean;
  // false in 'connect' mode - same reason DraggableCard has this: a
  // shape's own pan `.blocksExternalGesture(canvasPanGesture)` alone
  // was not enough to guarantee the canvas's connect-drag wins (two
  // competing Pan gestures, not a Pan racing a Tap) - "блоки не
  // поєднуються звʼязками" turned out to be exactly this, shapes never
  // got the explicit `.enabled()` gate cards already needed for the
  // same reason.
  dragEnabled: boolean;
  canvasScale: SharedValue<number>;
  canvasPanGesture: ReturnType<typeof Gesture.Pan>;
  canvasHoldGesture: ReturnType<typeof Gesture.LongPress>;
  onTap: (shape: BoardShape) => void;
  onLongPress: (shape: BoardShape) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const reportedX = useSharedValue(shape.x);
  const reportedY = useSharedValue(shape.y);
  useEffect(() => {
    if (shape.x !== reportedX.value) {
      posX.value = shape.x;
      reportedX.value = shape.x;
    }
    if (shape.y !== reportedY.value) {
      posY.value = shape.y;
      reportedY.value = shape.y;
    }
    // A container drag this shape rode along on already folded the
    // offset into the committed x/y above - back to zero in the same
    // paint that adopts it, exactly as DraggableCard does for its own
    // column offset.
    containerOffsetX.value = 0;
    containerOffsetY.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape.x, shape.y]);

  const [live, setLive] = useState<{ width: number; height: number } | null>(null);
  const resizeBase = useRef({ width: 0, height: 0 });

  const panGesture = Gesture.Pan()
    .enabled(dragEnabled)
    .blocksExternalGesture(canvasPanGesture)
    .onStart(() => {
      runOnJS(onDragStart)(shape.id);
    })
    .onChange((e) => {
      posX.value += e.changeX / canvasScale.value;
      posY.value += e.changeY / canvasScale.value;
    })
    .onEnd(() => {
      reportedX.value = posX.value;
      reportedY.value = posY.value;
      runOnJS(onDragEnd)(shape.id, posX.value, posY.value);
    });
  const tapGesture = Gesture.Tap().onEnd(() => {
    runOnJS(onTap)(shape);
  });
  const longPressGesture = Gesture.LongPress()
    .minDuration(350)
    .maxDistance(10)
    .blocksExternalGesture(canvasHoldGesture, canvasPanGesture)
    .onStart(() => {
      runOnJS(onLongPress)(shape);
    });
  const gesture = Gesture.Race(panGesture, tapGesture, longPressGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: posX.value + (followsContainerDrag ? containerOffsetX.value : 0) },
      { translateY: posY.value + (followsContainerDrag ? containerOffsetY.value : 0) },
    ],
  }));

  // Text is as WIDE as its own words too, not only as tall - see
  // approxTextShapeWidth's own comment. No resize grip ever changes it
  // (below), so `live` never holds a width for a text shape and this is
  // simply `undefined` there, the same way height already was.
  const width = shape.kind === 'text' ? undefined : live?.width ?? shape.width;
  // Text is as tall as its own words; everything else is the box it was
  // given. A square and a circle are the same shapes as a rectangle and
  // an ellipse with one rule added, which is why they are separate kinds
  // rather than a flag: the rule belongs to the shape, not to a mode.
  const locked = shape.kind === 'square' || shape.kind === 'circle';
  const height = shape.kind === 'text' ? undefined : locked ? width : live?.height ?? shape.height;

  const resizeGesture = Gesture.Pan()
    .blocksExternalGesture(canvasPanGesture)
    .onStart(() => {
      resizeBase.current = { width: width ?? 0, height: height ?? shape.height };
    })
    .onChange((e) => {
      const nextW = clampShapeSize(resizeBase.current.width + e.translationX / canvasScale.value);
      const nextH = locked
        ? nextW
        : clampShapeSize(resizeBase.current.height + e.translationY / canvasScale.value);
      setLive({ width: nextW, height: nextH });
    })
    .onEnd(() => {
      const next = live;
      setLive(null);
      if (next) runOnJS(onResize)(shape.id, next.width, locked ? next.width : next.height);
    })
    .runOnJS(true);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.shape,
          { width, height, opacity: dimmed ? 0.28 : 1 },
          animatedStyle,
          isSelected && styles.shapeSelected,
        ]}
        pointerEvents={dimmed ? 'none' : 'auto'}
      >
        <ShapeBody
          shape={shape}
          width={width ?? 0}
          height={height ?? 0}
          stroke={shape.color ?? theme.canvas.inkMuted}
          fill={shapeFillFor(shape, shape.color ?? theme.canvas.inkMuted, theme)}
          ink={theme.canvas.ink}
        />
        {isSelected && shape.kind !== 'text' && (
          <GestureDetector gesture={resizeGesture}>
            <View style={styles.cardGrip}>
              <Ionicons name="resize-outline" size={13} color="#fff" />
            </View>
          </GestureDetector>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

type Props = NativeStackScreenProps<BoardsStackParamList, 'Board'>;

// Stage 1 of the "Дошка" feature (see DEVELOPMENT_PLAN.md / PROJECT_BRIEF.md):
// a pannable/zoomable canvas of cards. A card is deliberately just a `Block`
// plus x/y/width (see BoardCard in types.ts) - a card referencing an
// existing file/photo/link comes straight out of AddExistingItemModal
// unmodified, exactly like inserting one into a document does.
export default function BoardScreen() {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const keyboardHeight = useKeyboardHeight();
  const boardFocused = useIsFocused();
  const boardInsets = useSafeAreaInsets();
  // Typed against BOTH param lists - this screen lives inside the "Дошки"
  // tab's own nested BoardsStack (goBack to BoardsList) but also reaches
  // UP into the root stack to open Editor/EditorModal, which React
  // Navigation's navigate() resolves correctly at runtime by walking up
  // the navigator tree regardless of which param list a call site is
  // typed against.
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList & BoardsStackParamList>>();
  const { params } = useRoute<Props['route']>();
  const { boardId, openDocumentId } = params;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { isTwoPane } = useResponsiveLayout();
  // A document card opened beside the board instead of over it: the board
  // keeps panning and scrolling while the document is being written, which
  // is the whole point of a board full of documents. Full screen is still
  // a tap away, so nothing that worked before stops working.
  const [paneDocId, setPaneDocId] = useState<string | null>(null);
  // One column read as flowing text in the right-hand half. Not a document
  // and not a copy: it edits the cards themselves, which is why nothing
  // here is synchronised with anything. Opened by long-pressing a column
  // header. "Сформувати" from inside it still writes a real document, and
  // that document is a snapshot from then on.
  const [paneFullscreen, setPaneFullscreen] = useState(false);
  // The canvas's own size, which stops being the window's the moment a
  // document takes half of it. Screen->world maths below reads this, not
  // the window - the gestures report x/y relative to the canvas surface,
  // so the two must be the same rectangle.
  const [viewport, setViewport] = useState({ width: windowWidth, height: windowHeight });
  // Added on top of the fixed 104 the FAB/selection bar already clear the
  // floating tab bar by - a device with a tall gesture-nav inset needs more
  // than that fixed number to keep either from sitting partly behind it.
  // Same fix as BulkActionBar's own bottom offset.
  const bottomInset = useSafeAreaInsets().bottom;
  const dockClear = useDockClearance();
  const boardBlurTarget = useBlurTarget();

  const [title, setTitle] = useState('');
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [existingItemPickerVisible, setExistingItemPickerVisible] = useState(false);
  // Set when the pane's document was just made out of another one's
  // blocks - the offer to put it on a board rides in with it.
  const [paneOfferBoard, setPaneOfferBoard] = useState(false);
  const [editingCard, setEditingCard] = useState<BoardCard | null>(null);
  const [editingText, setEditingText] = useState('');
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  // The column a carried card is currently over - lit while it is, so the
  // magnet is seen and felt before the finger lifts.
  const [hoverColumnId, setHoverColumnId] = useState<string | null>(null);
  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);
  // 'move' - single-finger drag pans the canvas (the original Stage 1
  // behaviour). 'select' - single-finger drag instead draws a marquee
  // rectangle over the world, selecting every card it overlaps, so several
  // cards can be deleted or dragged as one group.
  // 'connect' - a single-finger drag from one card to another links them
  // with a mindmap line instead of panning or selecting.
  //
  // It always STARTS as move, on every device. Selecting is something the
  // hand asks for - by holding on bare canvas, see below - rather than a
  // state the board sits in from the moment it opens. Defaulting the web
  // to select worked, but it left the tool lit as though a mode had been
  // entered that nobody chose.
  const [canvasTool, setCanvasTool] = useState<'move' | 'select' | 'connect'>('move');
  // Isolation is deliberately its OWN flag, not a fourth canvasTool - it
  // is a lens over the whole board (dim/disable everything outside a
  // chain), not a way of interacting with the canvas the way move/
  // select/connect are, and it has to survive switching back to 'move'
  // to actually work with the isolated chain afterwards. `isolateArmed`
  // is the one-shot "next tap picks the chain" state; `isolatedIds` is
  // the chain itself once picked (null = not isolated).
  const [isolateArmed, setIsolateArmed] = useState(false);
  const [isolatedIds, setIsolatedIds] = useState<Set<string> | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [connections, setConnections] = useState<BoardConnection[]>([]);
  // The board's own furniture - see BoardShape. A list of its OWN, never
  // merged into `cards`, so nothing that collects, groups or exports
  // cards can ever pick one up.
  const [shapes, setShapes] = useState<BoardShape[]>([]);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [draggedShapeId, setDraggedShapeId] = useState<string | null>(null);
  // Whether the align/arrange list is open - see alignSelectedCards.
  const [alignMenuVisible, setAlignMenuVisible] = useState(false);
  const [shapeSheetVisible, setShapeSheetVisible] = useState(false);
  const [editingShape, setEditingShape] = useState<BoardShape | null>(null);
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  // A free-standing frame - see BoardContainer in types.ts. Unlike a
  // column, membership is never stored: whatever card or shape currently
  // sits inside a container's rectangle belongs to it, discovered fresh
  // every time the container itself is dragged (see containerMembersAt).
  const [containers, setContainers] = useState<BoardContainer[]>([]);
  const [renamingContainer, setRenamingContainer] = useState<BoardContainer | null>(null);
  const [draggingContainerId, setDraggingContainerId] = useState<string | null>(null);
  // Snapshotted the instant a container drag starts (see
  // startContainerDrag) - which cards and shapes were geometrically
  // inside it right then, so they can ride its live offset for the rest
  // of that one gesture. Recomputing this every frame would mean testing
  // every card and shape against the container's rectangle 60 times a
  // second for a number that cannot change mid-drag (the container's own
  // rectangle is the thing moving, and nothing else moves while it does).
  const [containerDragMembers, setContainerDragMembers] = useState<{ cardIds: Set<string>; shapeIds: Set<string> }>({
    cardIds: new Set(),
    shapeIds: new Set(),
  });
  // Organisational, not spatial - see BoardLayer. `layersDrawerVisible`
  // is the "Шари" bead's own sheet.
  const [layers, setLayers] = useState<BoardLayer[]>([]);
  const [layersDrawerVisible, setLayersDrawerVisible] = useState(false);
  const [renamingLayer, setRenamingLayer] = useState<BoardLayer | null>(null);
  const [collapsedLayerIds, setCollapsedLayerIds] = useState<Set<string>>(new Set());
  // The drawer isn't built on GlassLayer (see its own JSX comment), so it
  // has to catch the hardware back button itself, the way GlassLayer does
  // for every other sheet.
  useEffect(() => {
    if (!layersDrawerVisible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setLayersDrawerVisible(false);
      return true;
    });
    return () => sub.remove();
  }, [layersDrawerVisible]);
  // Each card's real rendered height, reported by its own onLayout - what
  // a column stacks by. State rather than a ref specifically so a height
  // change re-renders: a column whose single card grew has nothing to
  // reposition, but its OWN height still has to catch up.
  const [cardHeights, setCardHeights] = useState<Map<string, number>>(new Map());
  // The same heights, reachable from a callback that must not be rebuilt
  // every time one of them is measured - the listener depends on it, and
  // resubscribing on every measurement would be a lot of churn for
  // nothing.
  const cardHeightsRef = useRef(cardHeights);
  cardHeightsRef.current = cardHeights;
  const [renamingColumn, setRenamingColumn] = useState<BoardColumn | null>(null);
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);
  // Both steps of adding a link live in ONE piece of state so they can
  // share ONE dialog: asking for the URL, waiting on its preview, then (if
  // the page had no readable title) asking for a name. Two separate
  // dialogs meant Android unmounting one modal and mounting another
  // between the steps, which reads as a flicker. `kind` only picks the
  // first step's wording - where the link is actually filed comes from the
  // URL itself (see saveNewLink).
  const [linkPrompt, setLinkPrompt] = useState<
    | { step: 'url'; kind: 'other' | 'video' | 'geo'; busy: boolean }
    | { step: 'title'; url: string; preview: LinkPreview }
    | null
  >(null);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  // The world point under the pinch's own focal (the midpoint between the
  // two fingers), captured once when the pinch starts - see pinchGesture's
  // own comment for why this is what keeps zoom anchored to the fingers
  // instead of drifting toward the board's centre.
  const pinchFocalWorldX = useSharedValue(0);
  const pinchFocalWorldY = useSharedValue(0);
  // Shared by every selected card (see DraggableCard's isGroupDrag branch) -
  // whichever selected card is actually being dragged writes into this, and
  // every OTHER selected card reads the same live value in its own animated
  // style, which is what makes the whole selection visibly move together.
  const groupOffsetX = useSharedValue(0);
  const groupOffsetY = useSharedValue(0);
  // The same idea one level up: written by the column being dragged, read
  // by that column AND by every card inside it.
  const columnOffsetX = useSharedValue(0);
  const columnOffsetY = useSharedValue(0);
  // Same idea again, for a container - written by the container being
  // dragged, read by every card AND shape inside it (see
  // containerDragMembers for how "inside it" is decided).
  const containerOffsetX = useSharedValue(0);
  const containerOffsetY = useSharedValue(0);
  // A dragged card's own alignment guides - see GUIDE_COLOR. Written
  // entirely on the UI thread from inside DraggableCard's own pan
  // gesture (no runOnJS: there is nothing here JS needs to decide), read
  // by AlignmentGuides below to draw the two dashed lines. One of each
  // axis at a time - the CLOSEST match wins, same as a real design
  // tool's guides never show more than one line per direction at once.
  const guideVX = useSharedValue(0);
  const guideVVisible = useSharedValue(false);
  const guideHY = useSharedValue(0);
  const guideHVisible = useSharedValue(false);
  // The marquee-selection rectangle, in world coordinates (same space as
  // card x/y) so it can be rendered inside the same transformed `world`
  // container the cards live in and compared against their x/y directly -
  // no screen<->world conversion needed except once, at the very start of
  // the gesture (see selectGesture below).
  const marqueeStartX = useSharedValue(0);
  const marqueeStartY = useSharedValue(0);
  const marqueeCurrentX = useSharedValue(0);
  const marqueeCurrentY = useSharedValue(0);
  const marqueeVisible = useSharedValue(false);
  // The connect-drag's rubber-band line, in world coordinates like
  // everything else inside the transformed `world` container.
  const connectStartX = useSharedValue(0);
  const connectStartY = useSharedValue(0);
  const connectEndX = useSharedValue(0);
  const connectEndY = useSharedValue(0);
  const connectVisible = useSharedValue(false);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The updatedAt of the last write this device made, and the newest
  // thing that arrived while hands were busy. Between them they replace
  // the old rule "drop whatever arrives while saving", which lost the
  // update for good - see the listener below.
  const lastWriteAtRef = useRef(0);
  const pendingRemoteRef = useRef<{ cards: BoardCard[]; columns: BoardColumn[] } | null>(null);
  // What is believed to be in the document right now. Every save writes
  // the difference against this, so one moved card is one field - see
  // utils/boardStorage for why that matters.
  const savedRef = useRef<{
    cards: BoardCard[];
    columns: BoardColumn[];
    connections: BoardConnection[];
    shapes: BoardShape[];
    containers: BoardContainer[];
    layers: BoardLayer[];
  }>({
    cards: [],
    columns: [],
    connections: [],
    shapes: [],
    containers: [],
    layers: [],
  });
  // What shape the DOCUMENT is in, which decides how a save may be
  // written - and the one thing here that must never be guessed.
  //
  // 'array'   - written before cards were keyed. Merging a keyed patch
  //             into an array replaces it, so such a board is written
  //             whole once, and is keyed from then on.
  // 'keyed'   - the normal case: write only what changed.
  // 'unknown' - the CACHE says array. That is not evidence: the cache can
  //             be a copy from before another device migrated the board,
  //             and writing it whole from here would put this device's
  //             stale memory over everything that has happened since.
  //             Which is exactly what it did - a card that existed only
  //             on the other device stopped existing. So nothing is
  //             written at all until the server says which it is.
  const shapeRef = useRef<'unknown' | 'array' | 'keyed'>('keyed');
  // The card a connect-drag started on. A ref, not state, because the
  // gesture's own worklet closure is captured at creation time - by the
  // time onEnd fires, a state value set during the same gesture would
  // still read as whatever it was when the gesture was built. The ref is
  // read on the JS thread inside finishConnection, where it's current.
  const connectingFromIdRef = useRef<string | null>(null);
  // Every card's live world position, keyed by card id. Lifted out of the
  // cards themselves so a connection line can read both of its endpoints
  // while they're being dragged - a card's own component can't hand its
  // position to a sibling. Created with makeMutable rather than
  // useSharedValue because the set of cards is dynamic and hooks can't be.
  const cardPositions = useRef<Map<string, { x: SharedValue<number>; y: SharedValue<number> }>>(new Map());

  function positionFor(id: string, x: number, y: number) {
    const existing = cardPositions.current.get(id);
    if (existing) return existing;
    const created = { x: makeMutable(x), y: makeMutable(y) };
    cardPositions.current.set(id, created);
    return created;
  }

  function positionOf(card: BoardCard) {
    return positionFor(card.id, card.x, card.y);
  }

  useEffect(() => {
    (async () => {
      const docRef = doc(db, 'boards', boardId);
      let snapshot;
      try {
        snapshot = await getDocFromCache(docRef);
        if (!snapshot.exists()) throw new Error('not cached');
      } catch {
        snapshot = await getDoc(docRef);
      }
      const data = snapshot.data();
      const loadedCards = readBoardPart<BoardCard>(data?.cards);
      const loadedColumns = readBoardPart<BoardColumn>(data?.columns);
      const loadedConnections = readBoardPart<BoardConnection>(data?.connections);
      const loadedShapes = readBoardPart<BoardShape>(data?.shapes);
      const loadedContainers = readBoardPart<BoardContainer>(data?.containers);
      const loadedLayers = readBoardPart<BoardLayer>(data?.layers);
      const looksLikeArray =
        Array.isArray(data?.cards) || Array.isArray(data?.columns) || Array.isArray(data?.connections);
      // A keyed copy is trustworthy even from the cache - the change is
      // one way, and nothing turns a map back into an array. An array is
      // only believed when the server itself says so.
      shapeRef.current = !looksLikeArray ? 'keyed' : snapshot.metadata.fromCache ? 'unknown' : 'array';
      // Nothing is written while the shape is in doubt, so the doubt has
      // to be settled rather than waited out: only the server can say
      // whether those arrays are really there. Without this a board read
      // from the cache stayed unknown for as long as it was open, and
      // every change made to it was dropped.
      if (shapeRef.current === 'unknown') {
        getDoc(docRef)
          .then((fresh) => {
            const server = fresh.data();
            shapeRef.current =
              Array.isArray(server?.cards) || Array.isArray(server?.columns) || Array.isArray(server?.connections)
                ? 'array'
                : 'keyed';
          })
          // Offline, and the server cannot be asked. Treated as the old
          // shape, which writes the board whole - more than is needed,
          // and never wrong.
          .catch(() => {
            shapeRef.current = 'array';
          });
      }
      savedRef.current = {
        cards: loadedCards,
        columns: loadedColumns,
        connections: loadedConnections,
        shapes: loadedShapes,
        containers: loadedContainers,
        layers: loadedLayers,
      };
      setTitle(data?.title ?? 'Без назви');
      setCards(loadedCards);
      setConnections(loadedConnections);
      setShapes(loadedShapes);
      setColumns(loadedColumns);
      setContainers(loadedContainers);
      setLayers(loadedLayers);
      setIsLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  useEffect(() => {
    if (!isLoaded) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    const attemptSave = () => {
      // Cleared as the write goes out: the listener above reads this to
      // tell "a local change is waiting to be written" from "nothing
      // pending, so whatever arrives is news".
      saveTimeoutRef.current = null;
      // Nothing is written while the shape is in doubt - see shapeRef.
      // It comes back to ask again rather than giving up, because the
      // change is real and the only thing missing is the server's word
      // on how to write it down.
      if (shapeRef.current === 'unknown') {
        saveTimeoutRef.current = setTimeout(attemptSave, 1500);
        return;
      }
      // Written down before the write goes out: what comes back on the
      // listener a moment later is this same stamp, and that is how an
      // echo of our own write is told from another device's news.
      const updatedAt = Date.now();
      lastWriteAtRef.current = updatedAt;
      const saved = savedRef.current;
      const whole = shapeRef.current === 'array';
      const patch: Record<string, unknown> = { title, updatedAt };
      // A card in a column is DRAWN where the measured heights of the
      // cards above it put it, and those differ between a phone and a
      // laptop because text wraps differently. So that position is NOT
      // written: it is kept at whatever was written last, and the card's
      // index carries the real meaning.
      //
      // Without this the two devices never settle. Each recomputes the
      // stack for its own screen, writes the numbers, receives the
      // other's, recomputes again - which is what made the columns
      // flicker and the cards land on top of each other.
      const cardsToSave = asStored(cards, saved.cards);
      // Whole once for a board still in the old shape, the difference
      // ever after.
      const cardPatch = whole ? keyedAll(cardsToSave) : keyedDiff(saved.cards, cardsToSave);
      const columnPatch = whole ? keyedAll(columns) : keyedDiff(saved.columns, columns);
      const connectionPatch = whole ? keyedAll(connections) : keyedDiff(saved.connections, connections);
      const shapePatch = whole ? keyedAll(shapes) : keyedDiff(saved.shapes, shapes);
      const containerPatch = whole ? keyedAll(containers) : keyedDiff(saved.containers, containers);
      const layerPatch = whole ? keyedAll(layers) : keyedDiff(saved.layers, layers);
      if (cardPatch) patch.cards = cardPatch;
      if (columnPatch) patch.columns = columnPatch;
      if (connectionPatch) patch.connections = connectionPatch;
      if (shapePatch) patch.shapes = shapePatch;
      if (containerPatch) patch.containers = containerPatch;
      if (layerPatch) patch.layers = layerPatch;
      shapeRef.current = 'keyed';
      // Recorded as sent, not as acknowledged: Firestore keeps an unsent
      // write on disk and replays it in order, so it WILL arrive - and
      // until it does, the next difference must be measured against it
      // rather than against what the server has yet to hear.
      savedRef.current = { cards: cardsToSave, columns, connections, shapes, containers, layers };
      setDoc(doc(db, 'boards', boardId), patch, { merge: true });
    };
    saveTimeoutRef.current = setTimeout(attemptSave, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, cards, connections, columns, shapes, containers, layers, isLoaded]);

  // Read by the focus-time preview refresh below, which must not re-run
  // every time a card moves - so it reads the current cards through this
  // rather than closing over them.
  const cardsRef = useRef<BoardCard[]>(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  // A document card's preview (title, text, first image) is snapshotted
  // when the card is made, so editing the document leaves the card showing
  // the old version. Re-reading every document card's source whenever the
  // board comes back into focus is what catches that up: the only way a
  // document changes while its card exists is that you left the board to
  // edit it - including via the card's own "Редагувати", which opens the
  // editor as a modal over this screen and blurs it.
  const refreshDocumentPreviews = useCallback(async () => {
    const documentIds = [
      ...new Set(
        cardsRef.current
          .filter((c) => (c.type ?? 'paragraph') === 'document' && c.documentId)
          .map((c) => c.documentId as string)
      ),
    ];
    if (documentIds.length === 0) return;
    const snapshots = await Promise.all(documentIds.map((id) => getDoc(doc(db, 'documents', id))));
    const fresh = new Map<string, { title: string; text: string; imageUri?: string }>();
    snapshots.forEach((snapshot, index) => {
      // A document deleted elsewhere is left alone rather than blanked -
      // the card keeps showing what it last knew instead of silently
      // emptying itself.
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      const blocks: Block[] = data?.blocks ?? [];
      fresh.set(documentIds[index], {
        title: data?.title ?? 'Без назви',
        text: blocksToPreviewText(blocks).slice(0, 20000),
        // The cover image (DocumentEditorScreen's "..." menu) takes
        // priority over a body image block, same rule extractPreview
        // uses for the Documents/Search/Diary list cards.
        imageUri: data?.coverImageUri ?? firstImageUri(blocks),
      });
    });
    setCards((prev) => {
      let changed = false;
      const next = prev.map((card) => {
        if (!card.documentId) return card;
        const current = fresh.get(card.documentId);
        if (!current) return card;
        if (
          card.documentTitle === current.title &&
          (card.documentPreviewText ?? '') === current.text &&
          card.documentPreviewImageUri === current.imageUri
        ) {
          return card;
        }
        changed = true;
        const updated: BoardCard = { ...card, documentTitle: current.title };
        // Written as key-deletes rather than undefined values: Firestore
        // rejects undefined outright, and a document whose last image was
        // removed has to lose the field, not carry a stale one.
        if (current.text) updated.documentPreviewText = current.text;
        else delete updated.documentPreviewText;
        if (current.imageUri) updated.documentPreviewImageUri = current.imageUri;
        else delete updated.documentPreviewImageUri;
        return updated;
      });
      return changed ? next : prev;
    });
  }, []);

  // While a document is open in the pane beside the board, its card keeps
  // up with it: the editor saves on its own 600ms beat and this hears
  // every one of those writes, so the card on the canvas changes as the
  // document is written rather than when the pane is closed.
  useEffect(() => {
    if (!paneDocId) return;
    return onSnapshot(doc(db, 'documents', paneDocId), (snapshot) => {
      const data = snapshot.data();
      if (!data) return;
      const blocks: Block[] = data.blocks ?? [];
      const title = (data.title as string) ?? 'Без назви';
      const text = blocksToPreviewText(blocks).slice(0, 20000);
      const imageUri = (data.coverImageUri as string | undefined) ?? firstImageUri(blocks);
      setCards((prev) => {
        let changed = false;
        const next = prev.map((card) => {
          if (card.documentId !== paneDocId) return card;
          if (
            card.documentTitle === title &&
            (card.documentPreviewText ?? '') === text &&
            card.documentPreviewImageUri === imageUri
          ) {
            return card;
          }
          changed = true;
          // Key-deletes rather than undefined values, for the reason
          // refreshDocumentPreviews spells out: Firestore rejects
          // undefined, and a removed image has to lose its field.
          const updated: BoardCard = { ...card, documentTitle: title };
          if (text) updated.documentPreviewText = text;
          else delete updated.documentPreviewText;
          if (imageUri) updated.documentPreviewImageUri = imageUri;
          else delete updated.documentPreviewImageUri;
          return updated;
        });
        return changed ? next : prev;
      });
    });
  }, [paneDocId]);

  useFocusEffect(
    useCallback(() => {
      if (!isLoaded) return;
      refreshDocumentPreviews();
      // The editor saves on a 600ms debounce, so closing it right after
      // typing hands focus back here before that write is even issued -
      // the read above would then see the previous version. A second pass
      // safely past that window catches it.
      const timeout = setTimeout(refreshDocumentPreviews, 1000);
      return () => clearTimeout(timeout);
    }, [isLoaded, refreshDocumentPreviews])
  );

  // Positions and measured heights outlive the cards they belong to
  // otherwise - both are keyed by card id in structures React doesn't
  // clean up for us.
  useEffect(() => {
    if (!isLoaded) return;
    const live = new Set(cards.map((c) => c.id));
    for (const id of cardPositions.current.keys()) {
      if (!live.has(id)) cardPositions.current.delete(id);
    }
    setCardHeights((prev) => {
      if (![...prev.keys()].some((id) => !live.has(id))) return prev;
      return new Map([...prev].filter(([id]) => live.has(id)));
    });
  }, [cards, isLoaded]);

  // Re-lays every column out whenever a card's measured height changes or
  // the columns themselves do. Deliberately does NOT depend on `cards`:
  // the two places that change cards in a way a column cares about
  // (dropping one in, deleting one) reflow explicitly, and depending on
  // cards here would mean reflowing on every unrelated edit. reflowColumns
  // returns the same array when nothing moved, so this can't loop.
  useEffect(() => {
    if (!isLoaded) return;
    setCards((prev) => reflowColumns(prev, columns, cardHeights));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardHeights, columns, isLoaded]);

  // Anchored to the pinch's own focal point (the midpoint between the two
  // fingers), the way pinch-zoom works everywhere else - the world point
  // under that focal is captured ONCE, in onStart, then every frame's
  // translateX/Y is solved so that same world point stays under wherever
  // the focal is NOW (it can drift a little as two fingers move, and this
  // tracks that too, not just the distance between them). Before this it
  // only ever changed `scale`, which zooms around the view's own default
  // transform origin - the board's centre - so pinching anywhere else
  // visibly dragged the board diagonally toward or away from the centre
  // instead of staying under the fingers: the user's own read, confirmed.
  const pinchGesture = Gesture.Pinch()
    .onStart((e) => {
      savedScale.value = scale.value;
      pinchFocalWorldX.value = (e.focalX - viewport.width / 2 - translateX.value) / scale.value + WORLD_CENTER;
      pinchFocalWorldY.value = (e.focalY - viewport.height / 2 - translateY.value) / scale.value + WORLD_CENTER;
    })
    .onUpdate((e) => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
      scale.value = nextScale;
      translateX.value = e.focalX - viewport.width / 2 - (pinchFocalWorldX.value - WORLD_CENTER) * nextScale;
      translateY.value = e.focalY - viewport.height / 2 - (pinchFocalWorldY.value - WORLD_CENTER) * nextScale;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const panGesture = Gesture.Pan()
    // One finger only - two is a pinch (see canvasGesture's own
    // Simultaneous(pinchGesture, panGesture)), and pinchGesture's own
    // focal-tracking above already moves translateX/Y for a two-finger
    // touch, scale changing or not. Letting this ALSO claim a two-finger
    // touch meant both gestures wrote translateX/Y on the same frames,
    // each from its own, different formula - fighting over the same
    // value is what the diagonal drift actually was.
    .minPointers(1)
    .maxPointers(1)
    // A hold and a drag start the same way, and the canvas used to take
    // the very first pixel - so a hand that meant to hold had already
    // moved the board before the press could count. Now it has to travel
    // before it is a drag, which leaves room for the hold to win.
    .minDistance(12)
    // Same resync as pinchGesture's own onStart, same reason: a fit-to-
    // bounds pan (isolation, "показати на дошці") moves translateX/Y
    // outside this gesture, and the next drag has to pick up from there,
    // not from wherever the PREVIOUS drag happened to end.
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  // A fresh marquee replaces whatever was selected before, rather than
  // adding to it - simpler to reason about than shift-click-style additive
  // selection, and matches what "draw a box around the things you want"
  // reads as as a first pass.
  function finishMarqueeSelection(x1: number, y1: number, x2: number, y2: number) {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    const matched = cards.filter(
      (c) => c.x < right && c.x + c.width > left && c.y < bottom && c.y + APPROX_CARD_HEIGHT > top
    );
    setSelectedCardIds(new Set(matched.map((c) => c.id)));
  }

  // Held in a ref so the context-menu callback above can reach it
  // without this function having to move up the file.
  const cardAtRef = useRef<(x: number, y: number) => BoardCard | undefined>(() => undefined);
  cardAtRef.current = cardAt;

  function cardAt(worldX: number, worldY: number): BoardCard | undefined {
    // Last match wins - cards later in the array paint on top of earlier
    // ones, so where they overlap the visually topmost is the one meant.
    return cards
      .filter(
        (c) =>
          worldX >= c.x &&
          worldX <= c.x + c.width &&
          worldY >= c.y &&
          worldY <= c.y + APPROX_CARD_HEIGHT
      )
      .pop();
  }

  // What an arrow may start from or land on. Cards first, then the
  // furniture underneath them, then a container last of all - it is the
  // bottom-most layer on screen (see DraggableContainer), so it should
  // be the last thing a connect-drag falls back to as well: a card is drawn on top.
  function nodeAt(worldX: number, worldY: number): BoardNode | undefined {
    const card = cardAt(worldX, worldY);
    if (card) return nodeById.get(card.id);
    const shapeHit = shapes
      .map((sh) => nodeById.get(sh.id))
      .filter(
        (n): n is BoardNode =>
          !!n &&
          worldX >= n.x &&
          worldX <= n.x + n.width &&
          worldY >= n.y &&
          worldY <= n.y + n.height
      )
      .pop();
    if (shapeHit) return shapeHit;
    return containers
      .map((c) => nodeById.get(c.id))
      .filter(
        (n): n is BoardNode =>
          !!n &&
          worldX >= n.x &&
          worldX <= n.x + n.width &&
          worldY >= n.y &&
          worldY <= n.y + n.height
      )
      .pop();
  }

  function beginConnection(worldX: number, worldY: number) {
    const source = nodeAt(worldX, worldY);
    connectingFromIdRef.current = source ? source.id : null;
  }

  function finishConnection(worldX: number, worldY: number) {
    const fromId = connectingFromIdRef.current;
    connectingFromIdRef.current = null;
    if (!fromId) return;
    const target = nodeAt(worldX, worldY);
    if (!target || target.id === fromId) return;
    setConnections((prev) => {
      // Links are undirected as far as the user is concerned, so a pair
      // that's already joined (in either direction) isn't joined twice.
      const exists = prev.some(
        (c) =>
          (c.fromCardId === fromId && c.toCardId === target.id) ||
          (c.fromCardId === target.id && c.toCardId === fromId)
      );
      if (exists) return prev;
      return [...prev, { id: generateId(), fromCardId: fromId, toCardId: target.id }];
    });
  }

  // Every id reachable from `startId` by following connections,
  // transitively - "ланцюжок" is the whole connected component, not
  // just direct neighbours. `connections`' own fromCardId/toCardId are
  // generic node ids already (nodeAt already returns shapes and
  // containers, not only cards - see nodeAt's own comment), so this
  // walks cards, shapes and containers alike without needing to know
  // which is which.
  function connectedComponent(startId: string): Set<string> {
    const adjacency = new Map<string, string[]>();
    for (const c of connections) {
      if (!adjacency.has(c.fromCardId)) adjacency.set(c.fromCardId, []);
      if (!adjacency.has(c.toCardId)) adjacency.set(c.toCardId, []);
      adjacency.get(c.fromCardId)!.push(c.toCardId);
      adjacency.get(c.toCardId)!.push(c.fromCardId);
    }
    const visited = new Set<string>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return visited;
  }

  // Pans and zooms so every id in `ids` fits on screen - see
  // ISOLATE_MAX_SCALE's own comment for why this has a lower ceiling
  // than the pinch gesture's own MAX_SCALE. Reads each id's bounds from
  // nodeById, which already covers cards, shapes AND containers.
  function fitViewToBounds(ids: Set<string>) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    ids.forEach((id) => {
      const node = nodeById.get(id);
      if (!node) return;
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    });
    if (!Number.isFinite(minX)) return;
    const boxWidth = Math.max(1, maxX - minX);
    const boxHeight = Math.max(1, maxY - minY);
    const fitScale = Math.min(
      (viewport.width * ISOLATE_FIT_FRACTION) / boxWidth,
      (viewport.height * ISOLATE_FIT_FRACTION) / boxHeight
    );
    const nextScale = Math.min(ISOLATE_MAX_SCALE, Math.max(MIN_SCALE, fitScale));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    scale.value = withTiming(nextScale, { duration: 320 });
    translateX.value = withTiming(-(centerX - WORLD_CENTER) * nextScale, { duration: 320 });
    translateY.value = withTiming(-(centerY - WORLD_CENTER) * nextScale, { duration: 320 });
  }

  // The tap that actually enters isolation, once armed - see
  // isolateArmed's own comment. Any card, shape or container's own tap
  // handler checks this first (see their call sites below) instead of
  // doing its usual thing.
  function pickIsolationAnchor(id: string) {
    setIsolateArmed(false);
    const ids = connectedComponent(id);
    setIsolatedIds(ids);
    fitViewToBounds(ids);
  }

  // The dock's own toggle: arm it (waiting for the next tap), or - if
  // already isolated - leave isolation and let everything else on the
  // board light back up. Pressing it again while armed but before
  // anything is picked cancels the arm instead of doing nothing.
  function toggleIsolation() {
    if (isolatedIds !== null) {
      setIsolatedIds(null);
      return;
    }
    setIsolateArmed((armed) => !armed);
  }

  // Same screen->world conversion the marquee does, for the same reason -
  // once at the start, then the gesture's own translation from there.
  const connectGesture = Gesture.Pan()
    .onStart((e) => {
      const wx = (e.x - viewport.width / 2 - translateX.value) / scale.value + WORLD_CENTER;
      const wy = (e.y - viewport.height / 2 - translateY.value) / scale.value + WORLD_CENTER;
      connectStartX.value = wx;
      connectStartY.value = wy;
      connectEndX.value = wx;
      connectEndY.value = wy;
      connectVisible.value = true;
      runOnJS(beginConnection)(wx, wy);
    })
    .onUpdate((e) => {
      connectEndX.value = connectStartX.value + e.translationX / scale.value;
      connectEndY.value = connectStartY.value + e.translationY / scale.value;
    })
    .onEnd(() => {
      runOnJS(finishConnection)(connectEndX.value, connectEndY.value);
    })
    // Same reason as the card drag's own onFinalize - a cancelled gesture
    // never reaches onEnd, and the rubber band would hang there.
    .onFinalize(() => {
      connectVisible.value = false;
    });

  // Only active in 'select' mode (see canvasGesture below). `e.x`/`e.y` are
  // reported relative to the view this gesture is attached to
  // (`canvasSurface`, which fills the whole screen), so they're already
  // absolute screen coordinates - converting the START point into world
  // coordinates once is enough; every point after that is just that start
  // plus the gesture's own cumulative translation (divided by scale, same
  // trick card-dragging already uses), no repeated screen<->world math.
  const selectGesture = Gesture.Pan()
    .onStart((e) => {
      const wx = (e.x - viewport.width / 2 - translateX.value) / scale.value + WORLD_CENTER;
      const wy = (e.y - viewport.height / 2 - translateY.value) / scale.value + WORLD_CENTER;
      marqueeStartX.value = wx;
      marqueeStartY.value = wy;
      marqueeCurrentX.value = wx;
      marqueeCurrentY.value = wy;
      marqueeVisible.value = true;
    })
    .onUpdate((e) => {
      marqueeCurrentX.value = marqueeStartX.value + e.translationX / scale.value;
      marqueeCurrentY.value = marqueeStartY.value + e.translationY / scale.value;
    })
    .onEnd(() => {
      marqueeVisible.value = false;
      runOnJS(finishMarqueeSelection)(
        marqueeStartX.value,
        marqueeStartY.value,
        marqueeCurrentX.value,
        marqueeCurrentY.value
      );
    });

  // Simultaneous here only combines the canvas's OWN pinch+pan with each
  // other. A card's Pan (see DraggableCard) sits on its own nested
  // GestureDetector and explicitly calls `.blocksExternalGesture(...)`
  // against whichever of these two is currently active - gesture-handler's
  // default is to treat gestures in separate GestureDetectors as fully
  // independent (NOT exclusive), so without that explicit block this
  // canvas gesture was free to also recognize a sliver of movement on a
  // touch that started on a card, visible as a jitter once the touch
  // lifted and that unwanted micro-pan committed. Pinch-zoom is
  // deliberately unavailable while selecting - zoom first, then switch
  // tools to draw the box.
  const canvasBlockingGesture =
    canvasTool === 'select' ? selectGesture : canvasTool === 'connect' ? connectGesture : panGesture;
  // A tap on bare canvas puts the selection down. Reaching for the cross
  // in the bar to say "never mind" is a step nobody takes willingly, and
  // clicking the empty space beside a thing is how every canvas says it.
  //
  // Raced against the others rather than added to them: a tap and a drag
  // begin identically, so whichever one the hand turns out to be making
  // wins, and a marquee is never cancelled by the touch that starts it.
  // Putting the selection down on bare canvas, and coming out of the mode
  // with it. The button in the rail is not a preference, it says what the
  // board is doing right now: lit while there is a selection to work with
  // - including while it is being carried - and out again the moment
  // there is not.
  useEffect(() => {
    if (selectedCardIds.size < 2) setAlignMenuVisible(false);
  }, [selectedCardIds]);

  const clearSelection = useCallback(() => {
    setSelectedShapeId(null);
    setSelectedCardIds(new Set());
    setCanvasTool('move');
  }, []);

  const clearSelectionGesture = Gesture.Tap()
    .maxDuration(250)
    .onEnd((_event, success) => {
      if (success) runOnJS(clearSelection)();
    });

  // Holding bare canvas asks for the marquee. The same gesture a phone
  // uses to mean "I want to do something with these, not to them", and on
  // a laptop it is the press that the mouse has been holding anyway.
  const holdToSelectGesture = Gesture.LongPress()
    .minDuration(350)
    // A hand is never perfectly still, least of all on a trackpad.
    .maxDistance(10)
    .onStart(() => {
      runOnJS(hapticPickUp)();
      runOnJS(setCanvasTool)('select');
    });

  const canvasGesture = Gesture.Race(
    clearSelectionGesture,
    canvasTool === 'move' ? holdToSelectGesture : Gesture.Tap().enabled(false),
    canvasTool === 'select'
      ? selectGesture
      : canvasTool === 'connect'
        ? connectGesture
        : Gesture.Simultaneous(pinchGesture, panGesture)
  );

  const marqueeAnimatedStyle = useAnimatedStyle(() => ({
    opacity: marqueeVisible.value ? 1 : 0,
    left: Math.min(marqueeStartX.value, marqueeCurrentX.value),
    top: Math.min(marqueeStartY.value, marqueeCurrentY.value),
    width: Math.abs(marqueeCurrentX.value - marqueeStartX.value),
    height: Math.abs(marqueeCurrentY.value - marqueeStartY.value),
  }));

  // A trackpad and a mouse have no pinch; in a browser this is what
  // gives the board its zoom (see useCanvasWheel). A no-op on the phone.
  const canvasRef = useRef<View | null>(null);
  // Where the right button was pressed, and on which card. A laptop's
  // answer to holding a card down - see useContextMenu.
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number; card: BoardCard } | null>(null);
  useCanvasWheel(canvasRef, {
    scale,
    savedScale,
    translateX,
    translateY,
    savedTranslateX,
    savedTranslateY,
    viewport,
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
  });

  // The same screen->world conversion the marquee and the connector use.
  // Selecting the card first means every action below is the SAME code
  // the selection bar runs - the menu is a second way in, not a second
  // implementation.
  const openCardMenu = useCallback(
    (x: number, y: number) => {
      const worldX = (x - viewport.width / 2 - translateX.value) / scale.value + WORLD_CENTER;
      const worldY = (y - viewport.height / 2 - translateY.value) / scale.value + WORLD_CENTER;
      const card = cardAtRef.current(worldX, worldY);
      if (!card) {
        setCardMenu(null);
        return;
      }
      // Deliberately NOT selected: selecting it would raise the
      // selection bar at the foot of the screen, and two menus for one
      // right-click is exactly what this was meant to replace.
      setCardMenu({ x, y, card });
    },
    [viewport.width, viewport.height, translateX, translateY, scale]
  );
  useContextMenu(canvasRef, openCardMenu);

  const worldAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  function addTextCard() {
    setAddSheetVisible(false);
    const card = newTextCard(cards.length);
    setCards((prev) => [...prev, card]);
    setEditingCard(card);
    setEditingText('');
  }

  function openExistingItemPicker() {
    setAddSheetVisible(false);
    setExistingItemPickerVisible(true);
  }

  // Everything below creates a BRAND NEW database record from the board and
  // drops a card for it, rather than referencing something that already
  // exists (that's openExistingItemPicker's job). Each one writes the same
  // record shape its own database screen's "+" writes, `usedInDocuments`
  // included: the object belongs to its database from the moment it's
  // made, and the board card is a reference to it like any other.

  async function createDocumentCard() {
    setAddSheetVisible(false);
    const now = Date.now();
    const created = await addDoc(documentsCollection, {
      title: 'Без назви',
      createdAt: now,
      updatedAt: now,
      blocks: [],
    });
    setCards((prev) => [...prev, newDocumentCard({ id: created.id, title: 'Без назви' }, {}, prev.length)]);
  }

  // One flow behind all three link menu entries. The category a link ends
  // up filed under (video / geo / other - separate databases as far as the
  // UI is concerned) is derived from the fetched preview's siteName, NOT
  // from which entry was tapped, exactly as LinksScreen does it: paste a
  // YouTube URL under "Геоточка" and it still correctly lands in
  // YouTube/TikTok rather than being mis-filed.
  function openLinkPrompt(kind: 'other' | 'video' | 'geo') {
    setAddSheetVisible(false);
    setLinkPrompt({ step: 'url', kind, busy: false });
  }

  // The dialog stays open the whole way through: it goes busy while the
  // preview is fetched, then either closes (the page named itself) or
  // turns into the name question.
  async function submitLinkStep(value: string) {
    if (!linkPrompt) return;
    if (linkPrompt.step === 'title') {
      const { url, preview } = linkPrompt;
      setLinkPrompt(null);
      saveNewLink(url, preview, value.trim());
      return;
    }
    const url = value.trim();
    if (!url) return;
    setLinkPrompt({ ...linkPrompt, busy: true });
    const preview = await fetchLinkPreview(url);
    if (preview.title) {
      setLinkPrompt(null);
      saveNewLink(url, preview, preview.title);
    } else {
      // No title to read out of the page (a raw-coordinates Maps link, or
      // a page with no og:title) - ask rather than filing something
      // nameless nobody could find later. Same as LinksScreen's own "+".
      setLinkPrompt({ step: 'title', url, preview });
    }
  }

  async function saveNewLink(url: string, preview: LinkPreview, title: string) {
    // Keyed by the URL (linkDocId), not a fresh id - the same link saved
    // twice is one record, which is what makes the databases dedupe.
    const id = linkDocId(url);
    const now = Date.now();
    const data: Record<string, unknown> = { url, updatedAt: now, createdAt: now, usedInDocuments: {} };
    if (title) data.title = title;
    if (preview.imageUrl) data.imageUrl = preview.imageUrl;
    if (preview.siteName) data.siteName = preview.siteName;
    await setDoc(doc(db, 'links', id), data, { merge: true });
    setCards((prev) => [
      ...prev,
      cardFromExistingBlock(blockFromLink({ url, title, imageUrl: preview.imageUrl, siteName: preview.siteName }), prev.length),
    ]);
  }

  function createImageCard() {
    setAddSheetVisible(false);
    ask({
      title: 'Нове зображення',
      actions: [
        { id: 'gallery', label: 'Галерея', icon: 'images-outline' },
        { id: 'camera', label: 'Камера', icon: 'camera-outline' },
      ],
    }).then((answer) => {
      if (answer === 'gallery' || answer === 'camera') pickImage(answer);
    });
  }

  async function pickImage(source: 'gallery' | 'camera') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        // A whole set at once - the board is where a handful of pictures
        // are laid out beside each other, and one at a time meant opening
        // the gallery again for every one of them.
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 1,
            allowsMultipleSelection: true,
          });
    if (result.canceled) return;
    // One after another, in the order they were picked: each is written,
    // laid on the board, and only then the next - so two pictures cannot
    // land on the same spot.
    for (const asset of result.assets) await addPhotoCard(asset);
  }

  async function addPhotoCard(asset: ImagePicker.ImagePickerAsset) {
    const imageUri = await compressPickedImage(asset.uri, asset.width, asset.height);
    const id = generateId();
    const now = Date.now();
    await setDoc(
      doc(db, 'photos', id),
      { imageUri, imageFit: 'contain', createdAt: now, updatedAt: now, usedInDocuments: {} },
      { merge: true }
    );
    backupFileToDrive(imageUri, `${id}.jpg`, 'image/jpeg', 'Photos').then((uploaded) => {
      if (!uploaded) return;
      updateDoc(doc(db, 'photos', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
      // The card needs it too, and this is the only moment it can be
      // learned: the upload finishes after the card is already made. A
      // card without it is a picture no other device can ever fetch.
      setCards((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, driveFileId: uploaded.fileId, driveBytes: uploaded.bytes } : c
        )
      );
    });
    setCards((prev) => [
      ...prev,
      cardFromExistingBlock(blockFromPhoto({ id, imageUri, imageFit: 'contain', createdAt: now }), prev.length),
    ]);
  }

  async function createFileCard() {
    setAddSheetVisible(false);
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const id = generateId();
    const fileUri = `${LegacyFileSystem.cacheDirectory}${id}-${asset.name}`;
    await LegacyFileSystem.copyAsync({ from: asset.uri, to: fileUri });
    const now = Date.now();
    const data: Record<string, unknown> = {
      fileUri,
      fileName: asset.name,
      createdAt: now,
      updatedAt: now,
      usedInDocuments: {},
    };
    if (asset.mimeType) data.mimeType = asset.mimeType;
    await setDoc(doc(db, 'files', id), data, { merge: true });
    backupFileToDrive(fileUri, asset.name, asset.mimeType ?? 'application/octet-stream', 'Files').then((uploaded) => {
      if (!uploaded) return;
      updateDoc(doc(db, 'files', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
      // Same as the photo above: the card learns where its copy went, or
      // no other device can ever fetch it.
      setCards((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, driveFileId: uploaded.fileId, driveBytes: uploaded.bytes } : c
        )
      );
    });
    setCards((prev) => [
      ...prev,
      cardFromExistingBlock(
        blockFromFile({ id, fileUri, fileName: asset.name, mimeType: asset.mimeType, createdAt: now }),
        prev.length
      ),
    ]);
  }

  function addExistingCard(block: Block) {
    setExistingItemPickerVisible(false);
    setCards((prev) => [...prev, cardFromExistingBlock(block, prev.length)]);
  }

  async function addDocumentCard(document: { id: string; title: string }) {
    setExistingItemPickerVisible(false);
    // One extra read at add-time to snapshot a preview (full text, first
    // image) onto the card itself - AddExistingItemModal's own "Документи"
    // tab only ever carries {id, title} for its list, not blocks, so
    // there's nothing to preview from without this fetch. The full text is
    // cached (capped defensively, not just 4 lines) so the card can later
    // expand in place to show all of it without a second fetch - the
    // collapsed view just clips the same string to 4 lines via
    // `numberOfLines`.
    const snapshot = await getDoc(doc(db, 'documents', document.id));
    const data = snapshot.data();
    const blocks: Block[] = data?.blocks ?? [];
    const preview = {
      text: blocksToPreviewText(blocks).slice(0, 20000),
      // Cover image takes priority over a body image block - see
      // refreshDocumentPreviews' identical rule.
      imageUri: data?.coverImageUri ?? firstImageUri(blocks),
    };
    setCards((prev) => [...prev, newDocumentCard(document, preview, prev.length)]);
  }

  // Tapping a document card toggles it in place (see BoardCard's
  // documentExpanded) rather than opening a separate overlay - collapsed
  // shows a 4-line peek, expanded shows the whole cached preview text and
  // stays that way while the user keeps working with other cards, exactly
  // like every other card's position: it's just a field, so it persists
  // through the normal autosave and survives reopening the board.
  function toggleDocumentExpanded(card: BoardCard) {
    setCards((prev) =>
      prev.map((c) => (c.id === card.id ? { ...c, documentExpanded: !c.documentExpanded } : c))
    );
  }

  // The other half of the live link, and the half that was missing: this
  // screen read its cards once, at open, and wrote them back from memory
  // ever after. A card the document made never appeared here - and worse,
  // the next autosave overwrote it with this screen's older list, which is
  // what had the two sides writing each other in circles.
  //
  // Same rule as the document's own listener: take what arrives, but only
  // while nothing local is in flight - no pending save, no card or column
  // under the finger - and never when it matches what's already here.
  const applyRemote = useCallback(
    (incomingCards: BoardCard[], incomingColumns: BoardColumn[]) => {
      // What arrived is now what the document holds, so the next
      // difference is measured against it - otherwise the very next save
      // would write the other device's own changes back at it as if they
      // were ours. Kept exactly as it arrived, unstacked.
      const written = savedRef.current.cards;
      savedRef.current = { ...savedRef.current, cards: incomingCards, columns: incomingColumns };
      // Then stacked for THIS screen before it is shown. The positions in
      // the document are deliberately not kept up to date for cards in a
      // column - the index is what travels, because the drawn position
      // depends on heights this device measured for itself. So a change
      // from elsewhere has to be laid out again on arrival, or the cards
      // stay wherever the numbers last happened to say: a column with a
      // hole in it where a card used to be, and the ones below it hanging
      // past its bottom edge.
      setCards((current) => {
        // Anything changed here since the last write is a local edit that
        // has not been sent yet - a card just dragged into another
        // column, with the save still on its 600ms timer. Those keep
        // ours; everything else takes theirs. Imposing the whole arriving
        // board instead is what made a card spring back: the drop was
        // undone by news that left a moment before it happened.
        const storedNow = new Map(asStored(current, written).map((card) => [card.id, card]));
        const writtenById = new Map(written.map((card) => [card.id, card]));
        const mine = new Set(
          current
            .filter((card) => {
              const before = writtenById.get(card.id);
              return !before || !contentEqual(before, storedNow.get(card.id));
            })
            .map((card) => card.id)
        );
        const currentById = new Map(current.map((card) => [card.id, card]));
        const merged = incomingCards.map((card) =>
          mine.has(card.id) ? currentById.get(card.id) ?? card : card
        );
        // A card made here that the other side has not heard of yet.
        const arrived = new Set(incomingCards.map((card) => card.id));
        current.forEach((card) => {
          if (!arrived.has(card.id) && mine.has(card.id)) merged.push(card);
        });
        const stacked = reflowColumns(merged, incomingColumns, cardHeightsRef.current);
        return contentEqual(current, stacked) ? current : stacked;
      });
      setColumns((current) => (contentEqual(current, incomingColumns) ? current : incomingColumns));
    },
    []
  );

  useEffect(() => {
    if (!isLoaded) return;
    return onSnapshot(doc(db, 'boards', boardId), (snapshot) => {
      const data = snapshot.data() as
        | { cards?: unknown; columns?: unknown; connections?: unknown; updatedAt?: number }
        | undefined;
      if (!data) return;
      // The server has spoken, so the shape is no longer in doubt.
      if (!snapshot.metadata.fromCache) {
        shapeRef.current =
          Array.isArray(data.cards) || Array.isArray(data.columns) || Array.isArray(data.connections)
            ? 'array'
            : 'keyed';
      }
      // Our own write, still on its way to the server: Firestore shows it
      // locally first, and that reflection is not news from anywhere.
      if (snapshot.metadata.hasPendingWrites) return;
      // And our own write coming back settled. Compared for EQUALITY, not
      // for "older than" - the stamp is made by whichever device wrote
      // it, and two clocks are never quite the same. Ignoring everything
      // stamped earlier than our last write would silently ignore the
      // other device for as long as its clock ran behind.
      if ((data.updatedAt ?? 0) === lastWriteAtRef.current) return;
      const incomingCards = readBoardPart<BoardCard>(data.cards);
      const incomingColumns = readBoardPart<BoardColumn>(data.columns);
      // A card under the finger must not be yanked out from under it, so
      // this WAITS rather than dropping. Dropping is what the old rule
      // did, and Firestore sends each change exactly once - so an update
      // refused here was gone until the screen was opened again, which is
      // exactly how it behaved: nothing, then everything on reload.
      if (draggedCardId || draggingColumnId) {
        pendingRemoteRef.current = { cards: incomingCards, columns: incomingColumns };
        return;
      }
      applyRemote(incomingCards, incomingColumns);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, boardId, draggedCardId, draggingColumnId, applyRemote]);

  // The moment the hands are free, whatever waited arrives.
  useEffect(() => {
    if (draggedCardId || draggingColumnId) return;
    const pending = pendingRemoteRef.current;
    if (!pending) return;
    pendingRemoteRef.current = null;
    applyRemote(pending.cards, pending.columns);
  }, [draggedCardId, draggingColumnId, applyRemote]);

  // One column read as flowing text in the right-hand half - see
  // BoardColumnDocument. Editing there edits the cards themselves, so
  // there is nothing to keep in step with anything.
  const [viewerColumnId, setViewerColumnId] = useState<string | null>(null);
  // Pulling a group onto this board without going to the groups screen
  // first. Same two steps as there - which group, then which of its items -
  // except the board is already known, so the second question never
  // arises.
  const { groups, itemsByGroup, titleForItem, labelForItemKind } = useGroupItems();
  const [groupPickerVisible, setGroupPickerVisible] = useState(false);
  const [importingGroup, setImportingGroup] = useState<Group | null>(null);

  // Arriving from the document's own "show the board" button: the document
  // that sent us here opens beside the board it came from.
  useEffect(() => {
    if (openDocumentId && isTwoPane) setPaneDocId(openDocumentId);
  }, [openDocumentId, isTwoPane]);

  function editDocumentCard(card: BoardCard) {
    if (!card.documentId) return;
    if (isTwoPane) {
      setPaneDocId(card.documentId);
      return;
    }
    // The modal-presented registration of the same Editor screen (see
    // App.tsx) - slides up over the board and swipes back down to it,
    // rather than the sideways push/pop of a regular stack screen, so
    // editing feels like it's still happening on the board.
    navigation.navigate('EditorModal', { documentId: card.documentId });
  }

  function handleCardTap(card: BoardCard) {
    const type = card.type ?? 'paragraph';
    if (type === 'paragraph') {
      setEditingCard(card);
      setEditingText(card.text);
    } else if (type === 'document') {
      toggleDocumentExpanded(card);
    } else if (type === 'link' && card.linkUrl) {
      // A YouTube/TikTok card plays right here; any other link opens
      // externally, same split DocumentEditorScreen's own link blocks use.
      if (getVideoEmbedInfo(card.linkUrl)) {
        setPlayingVideoUrl(card.linkUrl);
      } else {
        Linking.openURL(card.linkUrl).catch(() => {});
      }
    }
  }

  function handleDragStart(id: string) {
    hapticPickUp();
    setDraggedCardId(id);
  }

  function measureCard(id: string, height: number) {
    setCardHeights((prev) => {
      const previous = prev.get(id);
      // Returning the same Map is what stops measure -> reflow -> layout ->
      // measure from looping once the height has settled.
      if (previous !== undefined && Math.abs(previous - height) < 1) return prev;
      const next = new Map(prev);
      next.set(id, height);
      return next;
    });
  }

  // Where the card being carried would land right now. Reported from the
  // drag itself (throttled - see DraggableCard's onHover), so the column
  // lights up and answers with a tick the moment it catches, instead of
  // the answer only arriving once the finger lifts.
  function reportCardHover(id: string, x: number, y: number) {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    const others = cards.filter((c) => c.id !== id);
    const centreY = y + heightOf(card, cardHeights) / 2;
    const target = columnAtPoint(
      columns,
      others,
      cardHeights,
      x + widthInColumn(card) / 2,
      centreY,
      card.columnId
    );
    const nextId = target?.id ?? null;
    if (nextId !== hoverColumnId) {
      setHoverColumnId(nextId);
      if (nextId) hapticDrop();
    }
  }

  // A picture made bigger. Only the width is kept - the height follows
  // it, so the picture keeps its shape (cardImageHeight).
  function commitCardResize(id: string, width: number) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, width } : c)));
  }

  function commitCardDrag(id: string, x: number, y: number) {
    setHoverColumnId(null);
    setCards((prev) => {
      const dropped = prev.map((c) => (c.id === id ? { ...c, x, y } : c));
      const card = dropped.find((c) => c.id === id);
      if (!card) return dropped;
      // Hit-tested against the OTHER cards' membership, so a card being
      // dragged out of a column doesn't count itself towards that column's
      // height while deciding whether it landed back inside it.
      const others = dropped.filter((c) => c.id !== id);
      const centreY = y + heightOf(card, cardHeights) / 2;
      const target = columnAtPoint(
        columns,
        others,
        cardHeights,
        x + widthInColumn(card) / 2,
        centreY,
        card.columnId
      );
      // Only a card that actually came to rest in a column gets the
      // "landed" feedback - one dropped on open canvas has nothing to
      // confirm, same rule the document editor's own drop follows.
      if (target && card.columnId !== target.id) hapticDrop();
      const assigned = dropped.map((c) => {
        if (c.id !== id) return c;
        if (target) return { ...c, columnId: target.id };
        return c.columnId ? releaseFromColumn(c) : c;
      });
      return reflowColumns(assigned, columns, cardHeights);
    });
    setDraggedCardId(null);
  }

  // Dragging any one selected card moves the whole selection - see
  // DraggableCard's isGroupDrag branch, which accumulates the shared delta
  // instead of moving just itself. A group drag deliberately doesn't do any
  // column assignment: several cards landing across different columns at
  // once has no obvious right answer, and reflow would yank them apart
  // mid-gesture.
  function commitGroupDrag(dx: number, dy: number) {
    setHoverColumnId(null);
    setCards((prev) => prev.map((c) => (selectedCardIds.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c)));
    setDraggedCardId(null);
  }

  function addColumn() {
    setColumns((prev) => {
      const x =
        prev.length === 0
          ? WORLD_CENTER - COLUMN_WIDTH / 2
          : Math.max(...prev.map((c) => c.x)) + COLUMN_WIDTH + COLUMN_SPACING;
      const y = prev.length === 0 ? WORLD_CENTER - COLUMN_MIN_HEIGHT / 2 : prev[0].y;
      return [...prev, { id: generateId(), title: `Стовпчик ${prev.length + 1}`, x, y }];
    });
    setAddSheetVisible(false);
  }

  // Both the column and its cards take the drag's own delta, so nothing
  // has to be recomputed from the column's new origin - and the reflow
  // effect that follows (columns changed) lands on the same positions,
  // which is what keeps the drop from visibly nudging anything.
  function commitColumnDrag(id: string, dx: number, dy: number) {
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, x: c.x + dx, y: c.y + dy } : c)));
    setCards((prev) => prev.map((c) => (c.columnId === id ? { ...c, x: c.x + dx, y: c.y + dy } : c)));
    setDraggingColumnId(null);
  }

  function renameColumn(column: BoardColumn, title: string) {
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, title: title.trim() || c.title } : c)));
    setRenamingColumn(null);
  }

  // This screen used to draw its own confirmation window, because the
  // system's white dialog stood out against the board's dark glass. Now
  // «Питання» looks like the board does, so there is nothing left to
  // work around.
  async function confirmDeleteColumn(column: BoardColumn) {
    const yes = await confirm({
      title: 'Видалити стовпчик?',
      message: 'Картки з нього залишаться на дошці.',
      confirmLabel: 'Видалити',
    });
    if (!yes) return;
    // Cards keep the position the column had them in - the reflow effect
    // below strips the now-dangling columnId when `columns` changes.
    setColumns((prev) => prev.filter((c) => c.id !== column.id));
  }

  function addContainer() {
    setContainers((prev) => {
      // The RIGHT edge of the rightmost container, not its left one - a
      // container's width varies (resizable, and wider than the default
      // once anyone drags its grip), so landing a fixed distance past
      // its own x, the way a column's fixed-width own math does, put
      // every new one deep inside the one before it: "області в дошці
      // створюються одна на одній".
      const x =
        prev.length === 0
          ? WORLD_CENTER - CONTAINER_DEFAULT_WIDTH / 2
          : Math.max(...prev.map((c) => c.x + c.width)) + CONTAINER_SPACING;
      const y = prev.length === 0 ? WORLD_CENTER - CONTAINER_DEFAULT_HEIGHT / 2 : prev[0].y;
      return [
        ...prev,
        {
          id: generateId(),
          title: `Область ${prev.length + 1}`,
          x,
          y,
          width: CONTAINER_DEFAULT_WIDTH,
          height: CONTAINER_DEFAULT_HEIGHT,
        },
      ];
    });
    setAddSheetVisible(false);
  }

  function renameContainer(container: BoardContainer, title: string) {
    setContainers((prev) => prev.map((c) => (c.id === container.id ? { ...c, title: title.trim() || c.title } : c)));
    setRenamingContainer(null);
  }

  async function confirmDeleteContainer(container: BoardContainer) {
    // Two questions, not one - "повинне бути запитання видалити
    // область і потім видалити чи залишити об'єкти області": deleting
    // the frame and deleting what's in it are two different things, and
    // "Видалити" alone used to always mean only the first.
    const choice = await ask({
      title: 'Видалити область?',
      message: 'Що зробити з обʼєктами всередині неї?',
      actions: [
        { id: 'keep', label: 'Залишити обʼєкти на дошці' },
        { id: 'deleteAll', label: 'Видалити разом з обʼєктами', tone: 'danger' },
      ],
    });
    if (choice === 'cancel') return;
    const { cardIds, shapeIds } = containerMembersAt(container);
    setContainers((prev) => prev.filter((c) => c.id !== container.id));
    if (choice === 'deleteAll') {
      if (cardIds.size > 0) setCards((prev) => prev.filter((c) => !cardIds.has(c.id)));
      if (shapeIds.size > 0) setShapes((prev) => prev.filter((sh) => !shapeIds.has(sh.id)));
    }
  }

  function resizeContainer(id: string, width: number, height: number) {
    setContainers((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, width: clampContainerWidth(width), height: clampContainerHeight(height) } : c
      )
    );
  }

  function stepContainerTextSize(container: BoardContainer, dir: 1 | -1) {
    const current = container.fontSize ?? SHAPE_LABEL_SIZE_DEFAULT;
    const next = stepTextSize(current, dir);
    setContainers((prev) => prev.map((c) => (c.id === container.id ? { ...c, fontSize: next } : c)));
  }

  // LAYERS - see BoardLayer. Purely organisational: a card/shape/
  // container names its layer by id, nothing here has a position of its
  // own.
  const layersById = useMemo(() => {
    const map = new Map<string, BoardLayer>();
    layers.forEach((l) => map.set(l.id, l));
    return map;
  }, [layers]);

  // Hidden if the object says so itself, OR its own layer does - either
  // one is enough (see BoardCard's own `hidden` comment).
  function isHidden(obj: { hidden?: boolean; layerId?: string }): boolean {
    return !!obj.hidden || (!!obj.layerId && !!layersById.get(obj.layerId)?.hidden);
  }
  // Lock only ever comes from the LAYER - there is no per-object lock,
  // on purpose: an object is either free or it is filed somewhere that
  // protects it, never protected on its own.
  function isLocked(obj: { layerId?: string }): boolean {
    return !!obj.layerId && !!layersById.get(obj.layerId)?.locked;
  }
  // For the connections loop, which only has an id on each end and has
  // to ask across all three kinds of node.
  function isObjectHiddenById(id: string): boolean {
    const card = cardById.get(id);
    if (card) return isHidden(card);
    const shape = shapes.find((s) => s.id === id);
    if (shape) return isHidden(shape);
    const container = containers.find((c) => c.id === id);
    if (container) return isHidden(container);
    return false;
  }

  function addLayer() {
    setLayers((prev) => [...prev, { id: generateId(), name: `Шар ${prev.length + 1}` }]);
  }

  function renameLayerTo(layer: BoardLayer, name: string) {
    const trimmed = name.trim();
    if (trimmed) setLayers((prev) => prev.map((l) => (l.id === layer.id ? { ...l, name: trimmed } : l)));
    setRenamingLayer(null);
  }

  function toggleLayerHidden(layer: BoardLayer) {
    setLayers((prev) => prev.map((l) => (l.id === layer.id ? { ...l, hidden: !l.hidden } : l)));
  }

  function toggleLayerLocked(layer: BoardLayer) {
    setLayers((prev) => prev.map((l) => (l.id === layer.id ? { ...l, locked: !l.locked } : l)));
  }

  async function confirmDeleteLayer(layer: BoardLayer) {
    const yes = await confirm({
      title: 'Видалити шар?',
      message: `Обʼєкти з шару "${layer.name}" стануть без шару.`,
      confirmLabel: 'Видалити',
    });
    if (!yes) return;
    setLayers((prev) => prev.filter((l) => l.id !== layer.id));
    setCards((prev) =>
      prev.map((c) => {
        if (c.layerId !== layer.id) return c;
        const { layerId: _drop, ...rest } = c;
        return rest;
      })
    );
    setShapes((prev) =>
      prev.map((sh) => {
        if (sh.layerId !== layer.id) return sh;
        const { layerId: _drop, ...rest } = sh;
        return rest;
      })
    );
    setContainers((prev) =>
      prev.map((c) => {
        if (c.layerId !== layer.id) return c;
        const { layerId: _drop, ...rest } = c;
        return rest;
      })
    );
  }

  // What the layers drawer's own list carries - a flat id across all
  // three kinds, since the drawer shows them side by side.
  type LayerMember = { kind: 'card' | 'shape' | 'container'; id: string };

  function setObjectLayer(member: LayerMember, layerId: string | null) {
    const apply = <T extends { layerId?: string }>(item: T): T => {
      if (layerId) return { ...item, layerId };
      const { layerId: _drop, ...rest } = item;
      return rest as T;
    };
    if (member.kind === 'card') setCards((prev) => prev.map((c) => (c.id === member.id ? apply(c) : c)));
    else if (member.kind === 'shape') setShapes((prev) => prev.map((sh) => (sh.id === member.id ? apply(sh) : sh)));
    else setContainers((prev) => prev.map((c) => (c.id === member.id ? apply(c) : c)));
  }

  function toggleObjectHidden(member: LayerMember) {
    if (member.kind === 'card') {
      setCards((prev) => prev.map((c) => (c.id === member.id ? { ...c, hidden: !c.hidden } : c)));
    } else if (member.kind === 'shape') {
      setShapes((prev) => prev.map((sh) => (sh.id === member.id ? { ...sh, hidden: !sh.hidden } : sh)));
    } else {
      setContainers((prev) => prev.map((c) => (c.id === member.id ? { ...c, hidden: !c.hidden } : c)));
    }
  }

  // "Показати на дошці" - the same fit-to-bounds isolation already uses,
  // aimed at just one object instead of a whole connected chain. Leaves
  // the drawer open on purpose - the user's own ask: seeing the board pan
  // to the object is the point, and closing the drawer to show it would
  // hide the very list they were just working from.
  function locateObject(id: string) {
    fitViewToBounds(new Set([id]));
  }

  // Every object, bucketed by its layer - '' is "Без шару", same
  // convention useCardCarry's own moveItem destination uses (null layerId
  // reads back as the empty path).
  const layerMembers = useMemo(() => {
    const map = new Map<string, LayerMember[]>();
    map.set('', []);
    layers.forEach((l) => map.set(l.id, []));
    const bucket = (layerId: string | undefined) => map.get(layerId && map.has(layerId) ? layerId : '')!;
    cards.forEach((c) => bucket(c.layerId).push({ kind: 'card', id: c.id }));
    shapes.forEach((s) => bucket(s.layerId).push({ kind: 'shape', id: s.id }));
    containers.forEach((c) => bucket(c.layerId).push({ kind: 'container', id: c.id }));
    return map;
  }, [layers, cards, shapes, containers]);

  function toggleLayerCollapsed(id: string) {
    setCollapsedLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function layerIdOfMember(member: LayerMember): string | null {
    if (member.kind === 'card') return cardById.get(member.id)?.layerId ?? null;
    if (member.kind === 'shape') return shapes.find((s) => s.id === member.id)?.layerId ?? null;
    return containers.find((c) => c.id === member.id)?.layerId ?? null;
  }

  // Where a carried object actually sits RIGHT NOW - not a fixed "current
  // folder" the way the explorer has one, since the drawer shows every
  // layer at once rather than standing inside one. Without this, dropping
  // an object that already has a layer back onto "Без шару" read as a
  // drop on its own origin (both '') and did nothing - see useCardCarry's
  // own settle().
  const layerDragOriginRef = useRef<string>('');
  const layersCarry = useCardCarry<LayerMember>({
    currentPath: layerDragOriginRef.current,
    onPickUp: (items) => {
      layerDragOriginRef.current = items[0] ? (layerIdOfMember(items[0]) ?? '') : '';
    },
    moveItem: async (member, destination) => {
      setObjectLayer(member, destination);
    },
    // No auto-scroll axis of its own - the drawer's list is short enough
    // that the carry's own edge-scroll isn't needed the way the kanban
    // board's is.
    scrollBy: () => {},
  });
  // Same long-press-then-drag shape as TasksScreen's own kanbanBoardGesture
  // - lives on the drawer's own scrollable list, not on each row, so it
  // survives a row scrolling off and back on screen.
  const layersDragGesture = Gesture.Pan()
    .activateAfterLongPress(400)
    .runOnJS(true)
    .onStart((e) => layersCarry.pickUpAt(e.absoluteX, e.absoluteY))
    .onUpdate((e) => layersCarry.updateCarry(e.absoluteX, e.absoluteY))
    .onEnd((_e, success) => {
      if (success) layersCarry.endCarry();
    })
    .onFinalize(() => layersCarry.cancelCarry());

  // What one row of the drawer's object list shows, across all three
  // kinds of board furniture it can hold.
  function labelForCard(card: BoardCard): string {
    return card.documentTitle || card.fileTitle || card.imageTitle || card.linkTitle || card.text?.trim() || 'Картка';
  }
  function iconForCard(card: BoardCard): keyof typeof Ionicons.glyphMap {
    switch (card.type) {
      case 'document':
        return 'document-text-outline';
      case 'image':
        return 'image-outline';
      case 'file':
        return 'document-outline';
      case 'link':
        return 'link-outline';
      default:
        return 'chatbox-outline';
    }
  }
  function labelForMember(member: LayerMember): string {
    if (member.kind === 'card') {
      const card = cardById.get(member.id);
      return card ? labelForCard(card) : 'Картка';
    }
    if (member.kind === 'shape') {
      const shape = shapes.find((s) => s.id === member.id);
      if (!shape) return 'Фігура';
      return shape.text?.trim() || SHAPE_MENU.find((m) => m.kind === shape.kind)?.label || 'Фігура';
    }
    const container = containers.find((c) => c.id === member.id);
    return container?.title || 'Область';
  }
  function iconForMember(member: LayerMember): keyof typeof Ionicons.glyphMap {
    if (member.kind === 'card') {
      const card = cardById.get(member.id);
      return card ? iconForCard(card) : 'chatbox-outline';
    }
    if (member.kind === 'shape') return 'shapes-outline';
    return 'scan-outline';
  }
  // This object's OWN hide flag - not combined with its layer's, unlike
  // isHidden/isObjectHiddenById: the row shows what tapping ITS eye would
  // toggle, and the layer's own eye (drawn on the layer's own row) already
  // says whether the whole layer is hidden.
  function hiddenForMember(member: LayerMember): boolean {
    if (member.kind === 'card') return !!cardById.get(member.id)?.hidden;
    if (member.kind === 'shape') return !!shapes.find((s) => s.id === member.id)?.hidden;
    return !!containers.find((c) => c.id === member.id)?.hidden;
  }

  // One row of the drawer's object list - registered with layersCarry as
  // both a drag source (registerCard) and, via its own eye/locate buttons,
  // a place to act on the object without lifting it at all.
  function renderLayerMemberRow(member: LayerMember) {
    const hidden = hiddenForMember(member);
    const isCarrying = !!layersCarry.ghost?.items.some(
      (one) => one.kind === member.kind && one.id === member.id
    );
    return (
      <View
        key={`${member.kind}:${member.id}`}
        ref={layersCarry.registerCard(member.id, () => [member], () => {})}
        collapsable={false}
        style={[styles.memberRow, isCarrying && styles.memberRowDimmed]}
      >
        <Ionicons name={iconForMember(member)} size={15} color={GLASS_TEXT_MUTED} />
        <Text style={styles.memberLabel} numberOfLines={1}>
          {labelForMember(member)}
        </Text>
        <Pressable hitSlop={8} onPress={() => toggleObjectHidden(member)}>
          <Ionicons
            name={hidden ? 'eye-off-outline' : 'eye-outline'}
            size={15}
            color={hidden ? '#F87171' : GLASS_TEXT_MUTED}
          />
        </Pressable>
        <Pressable hitSlop={8} onPress={() => locateObject(member.id)}>
          <Ionicons name="locate-outline" size={15} color={GLASS_TEXT_MUTED} />
        </Pressable>
      </View>
    );
  }

  // Long-pressing a card selects just that one, which surfaces the same
  // bottom action bar the marquee/select tool uses for a multi-card
  // selection - "Редагувати" for a lone document card, "Видалити" either
  // way - rather than jumping straight to a delete confirmation.
  // Long-pressing a column header used to delete it outright. It now asks
  // what to do with the column, because that header is where the reading
  // order lives - it's the natural place to ask for the document this
  // board would make. (Renaming is still a plain tap.)
  async function runGroupImport(
    group: Group,
    selected: { id: string; kind: string; databaseId?: string; data: Record<string, unknown> }[]
  ) {
    setImportingGroup(null);
    await importGroupToBoard(
      boardId,
      group,
      selected.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: titleForItem(item as Parameters<typeof titleForItem>[0]),
        databaseId: item.databaseId,
        data: item.data,
      })),
      labelForItemKind
    );
    // The import writes the board document directly; this screen hears
    // about the new cards through its own listener.
  }

  function handleCardLongPress(card: BoardCard) {
    setSelectedCardIds(new Set([card.id]));
  }

  // Told which cards to remove rather than reading the selection: the
  // bar hands it the selection, the right-click menu hands it the one
  // card it was opened on - which is what lets that menu act WITHOUT
  // selecting anything first, and so without raising the selection bar
  // as a second menu beside itself.
  function deleteCards(ids: Set<string>) {
    const count = ids.size;
    if (count === 0) return;
    confirm({
      title: count === 1 ? 'Видалити картку?' : `Видалити картки (${count})?`,
      confirmLabel: 'Видалити',
    }).then((yes) => {
      if (!yes) return;
      // Reflowed after the removal so a column closes the gap its
      // deleted card left behind.
      setCards((prev) => reflowColumns(prev.filter((c) => !ids.has(c.id)), columns, cardHeights));
      // A connection to a card that no longer exists would render as a
      // line into empty space, so they go with it.
      setConnections((prev) => prev.filter((c) => !ids.has(c.fromCardId) && !ids.has(c.toCardId)));
      setSelectedCardIds((prev) => {
        const left = new Set(prev);
        ids.forEach((id) => left.delete(id));
        // Nothing left to work with means the board is not selecting any
        // more, and the rail should stop saying that it is.
        if (left.size === 0) setCanvasTool('move');
        return left;
      });
    });
  }

  function deleteSelectedCards() {
    deleteCards(selectedCardIds);
  }

  // ALIGN AND ARRANGE. Plain state edits, not a gesture - each selected
  // card's x/y just becomes a different number, and the same effect
  // that already catches a REMOTE change (see DraggableCard's own
  // reportedX/Y) is what carries it onto the canvas smoothly; nothing
  // here has to touch a shared value directly.
  type AlignEdge = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';
  function alignSelectedCards(edge: AlignEdge) {
    setAlignMenuVisible(false);
    if (selectedCardIds.size < 2) return;
    const targets = cards.filter((c) => selectedCardIds.has(c.id));
    const box = (c: BoardCard) => ({
      left: c.x,
      right: c.x + widthInColumn(c),
      top: c.y,
      bottom: c.y + heightOf(c, cardHeights),
    });
    const boxes = targets.map(box);
    const minLeft = Math.min(...boxes.map((b) => b.left));
    const maxRight = Math.max(...boxes.map((b) => b.right));
    const minTop = Math.min(...boxes.map((b) => b.top));
    const maxBottom = Math.max(...boxes.map((b) => b.bottom));
    const centerX = (minLeft + maxRight) / 2;
    const centerY = (minTop + maxBottom) / 2;
    setCards((prev) =>
      prev.map((c) => {
        if (!selectedCardIds.has(c.id)) return c;
        const w = widthInColumn(c);
        const h = heightOf(c, cardHeights);
        switch (edge) {
          case 'left':
            return { ...c, x: minLeft };
          case 'right':
            return { ...c, x: maxRight - w };
          case 'top':
            return { ...c, y: minTop };
          case 'bottom':
            return { ...c, y: maxBottom - h };
          case 'centerX':
            return { ...c, x: centerX - w / 2 };
          case 'centerY':
            return { ...c, y: centerY - h / 2 };
        }
      })
    );
  }

  // "Розкласти сіткою." Reading order (top to bottom, left to right as
  // the cards stand NOW), packed into a near-square grid of UNIFORM
  // cells - the widest and tallest of the selection, so nothing
  // overlaps whatever the mix of card kinds. Anchored on the
  // selection's own top-left corner, so the tidy stays where the mess
  // was rather than jumping to the world's centre.
  const GRID_ARRANGE_GAP = 24;
  function arrangeSelectedGrid() {
    setAlignMenuVisible(false);
    if (selectedCardIds.size < 2) return;
    const targets = cards.filter((c) => selectedCardIds.has(c.id));
    const originX = Math.min(...targets.map((c) => c.x));
    const originY = Math.min(...targets.map((c) => c.y));
    const cellW = Math.max(...targets.map((c) => widthInColumn(c))) + GRID_ARRANGE_GAP;
    const cellH = Math.max(...targets.map((c) => heightOf(c, cardHeights))) + GRID_ARRANGE_GAP;
    const columns = Math.ceil(Math.sqrt(targets.length));
    const ordered = [...targets].sort((a, b) => a.y - b.y || a.x - b.x);
    const nextById = new Map(
      ordered.map((c, i) => [
        c.id,
        { x: originX + (i % columns) * cellW, y: originY + Math.floor(i / columns) * cellH },
      ])
    );
    setCards((prev) =>
      prev.map((c) => {
        const next = nextById.get(c.id);
        return next ? { ...c, ...next } : c;
      })
    );
  }

  function disconnectSelectedCards() {
    setConnections((prev) =>
      prev.filter((c) => !selectedCardIds.has(c.fromCardId) && !selectedCardIds.has(c.toCardId))
    );
    clearSelection();
  }

  function saveEditingText() {
    if (editingCard) {
      setCards((prev) => prev.map((c) => (c.id === editingCard.id ? { ...c, text: editingText } : c)));
    }
    setEditingCard(null);
  }

  function setEditingCardColor(color: string) {
    if (!editingCard) return;
    setEditingCard({ ...editingCard, color });
    setCards((prev) => prev.map((c) => (c.id === editingCard.id ? { ...c, color } : c)));
  }

  const existingItemExcludeIds = new Set(
    cards
      .filter(
        (c) =>
          ((c.type ?? 'paragraph') === 'file' && c.fileUri) ||
          ((c.type ?? 'paragraph') === 'image' && c.imageUri) ||
          c.isSticker
      )
      .map((c) => c.id)
  );

  // Only offered in the selection bar when exactly one document card is
  // selected - a lone sticky/link/file/etc. or any multi-card selection
  // has no single "Редагувати" target.
  const onlySelectedDocumentCard =
    selectedCardIds.size === 1
      ? cards.find((c) => selectedCardIds.has(c.id) && (c.type ?? 'paragraph') === 'document')
      : undefined;

  // The one selected card, whatever its kind - what the copy and read
  // actions below work on.
  const onlySelectedCard =
    selectedCardIds.size === 1 ? cards.find((c) => selectedCardIds.has(c.id)) : undefined;

  // Only a lone image card offers the caption toggle - see imageBare.
  const onlySelectedImageCard =
    onlySelectedCard && (onlySelectedCard.type ?? 'paragraph') === 'image' ? onlySelectedCard : undefined;

  // FURNITURE. Every one of these writes `shapes` and nothing else -
  // that separation is the whole design, see BoardShape.
  function addShape(kind: BoardShapeKind) {
    setShapeSheetVisible(false);
    const birth = SHAPE_BIRTH[kind];
    // Born where a new card is born, and nudged the same way, so two
    // made in a row do not land exactly on top of each other.
    const jitter = (shapes.length % 6) * 24;
    const shape: BoardShape = {
      id: generateId(),
      kind,
      x: WORLD_CENTER - birth.width / 2 + jitter,
      y: WORLD_CENTER - birth.height / 2 + jitter,
      width: birth.width,
      height: birth.height,
    };
    setShapes((prev) => [...prev, shape]);
    setSelectedShapeId(shape.id);
    // Straight into the words: a shape with nothing written in it is
    // rarely what anyone wanted, and a loose label is never.
    setEditingShape(shape);
  }

  function moveShape(id: string, x: number, y: number) {
    setShapes((prev) => prev.map((sh) => (sh.id === id ? { ...sh, x, y } : sh)));
  }

  function resizeShape(id: string, width: number, height: number) {
    setShapes((prev) => prev.map((sh) => (sh.id === id ? { ...sh, width, height } : sh)));
  }

  function setShapeText(id: string, text: string) {
    setShapes((prev) => prev.map((sh) => (sh.id === id ? { ...sh, text } : sh)));
  }

  function setShapeColour(id: string, colour: string | undefined) {
    setShapes((prev) => prev.map((sh) => (sh.id === id ? { ...sh, color: colour } : sh)));
  }

  function toggleShapeFilled(id: string) {
    setShapes((prev) => prev.map((sh) => (sh.id === id ? { ...sh, filled: !sh.filled } : sh)));
  }

  function stepShapeTextSize(shape: BoardShape, dir: 1 | -1) {
    const current = shape.fontSize ?? (shape.kind === 'text' ? SHAPE_TEXT_SIZE_DEFAULT : SHAPE_LABEL_SIZE_DEFAULT);
    const next = stepTextSize(current, dir);
    setShapes((prev) => prev.map((sh) => (sh.id === shape.id ? { ...sh, fontSize: next } : sh)));
  }

  function deleteShape(id: string) {
    setShapes((prev) => prev.filter((sh) => sh.id !== id));
    setConnections((prev) => prev.filter((c) => c.fromCardId !== id && c.toCardId !== id));
    setSelectedShapeId((current) => (current === id ? null : current));
  }

  const selectedShape = shapes.find((sh) => sh.id === selectedShapeId);

  function toggleImageBare(card: BoardCard) {
    setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, imageBare: !c.imageBare } : c)));
  }

  function toggleImageNatural(card: BoardCard) {
    setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, imageNatural: !c.imageNatural } : c)));
  }


  // A card's text as text: its own for a sticky, its document's whole body
  // for a document card - the preview on the card is clipped, and copying
  // half a document silently is worse than not offering it.
  async function textOfCard(card: BoardCard): Promise<string> {
    if ((card.type ?? 'paragraph') === 'document' && card.documentId) {
      const snapshot = await getDoc(doc(db, 'documents', card.documentId));
      const data = snapshot.data();
      if (!data) return card.documentPreviewText ?? '';
      const title = (data.title as string) ?? '';
      const body = blocksToPreviewText((data.blocks ?? []) as Block[]);
      return [title, body].filter((part) => part.trim() !== '').join('\n\n');
    }
    return card.text ?? '';
  }

  // Copying a card does both halves at once: its text goes to the system
  // clipboard, where any other app can take it, and the card ITSELF goes
  // to this app's own clipboard as the block it would be in a document -
  // which is what lets a photo be pasted as that same photo rather than a
  // second copy of it.
  async function copyCardText(card: BoardCard) {
    const {
      x: _x,
      y: _y,
      width: _width,
      color: _color,
      columnId: _columnId,
      documentExpanded: _expanded,
      ...block
    } = card;
    const asBlock = { ...(block as Block), type: (card.type === 'document' ? 'paragraph' : card.type) ?? 'paragraph' };
    copyObject({ label: card.type === 'document' ? 'текст' : labelForBlock(asBlock), block: asBlock });

    const text = await textOfCard(card);
    if (text.trim()) {
      // A document card has no block of its own to paste (a document
      // cannot nest in a document), so its text is what travels - and it
      // replaces the block above for that case.
      if (card.type === 'document') copyObject({ label: 'текст', block: { ...asBlock, text } });
      await Clipboard.setStringAsync(text);
    }
    hapticSuccess();
    clearSelection();
  }

  // Reading a card's text without opening anything that could change it -
  // and selecting part of it by hand, which is the whole point: a plain
  // Text on the canvas can't be selected, because a long press there means
  // "pick this card".
  const [readingCard, setReadingCard] = useState<{ card: BoardCard; text: string } | null>(null);
  async function openCardText(card: BoardCard) {
    clearSelection();
    setReadingCard({ card, text: await textOfCard(card) });
  }

  const cardById = new Map(cards.map((c) => [c.id, c]));

  // The names and pictures the reference cards show, as their records say
  // them now - see useLiveRecords. Listened for only when this board has
  // a card that refers to something.
  const hasReferenceCards = cards.some((c) => recordIdFor(c) !== null);
  const liveRecords = useLiveRecords(hasReferenceCards);
  // A dragged card's live position lives in its own shared values, which
  // the connection lines (drawn from React state) can't see - so rather
  // than leave a line anchored to where the card WAS for the length of the
  // drag, its links are hidden outright and come back correctly shaped
  // once the drop commits the new position. A group drag moves every
  // selected card, so all of their links go too.
  // Which shared offsets currently apply to this card, so a live line can
  // add exactly the same ones the card's own animated style does.
  // Every card's own bounds, for a dragged card's alignment guides to
  // compare itself against - see GUIDE_COLOR. Built once here rather
  // than once per card: every DraggableCard reads the SAME array, and
  // only the one actually being dragged ever does anything with it.
  const cardBoundsForGuides = cards.map((c) => ({
    id: c.id,
    x: c.x,
    y: c.y,
    width: widthInColumn(c),
    height: heightOf(c, cardHeights),
  }));

  // Every box an arrow may end on, cards and furniture together, looked
  // up by the one thing a connection actually stores: an id.
  const nodeById = new Map<string, BoardNode>();
  for (const card of cards) {
    nodeById.set(card.id, {
      id: card.id,
      x: card.x,
      y: card.y,
      width: widthInColumn(card),
      height: heightOf(card, cardHeights),
    });
  }
  for (const shape of shapes) {
    nodeById.set(shape.id, {
      id: shape.id,
      x: shape.x,
      y: shape.y,
      // Loose text auto-sizes its own box now and `shape.width` is no
      // longer what it is actually drawn at (see approxTextShapeWidth) -
      // stale here would aim an arrow, or a connect-mode tap, at where
      // the box used to end rather than where it now does.
      width: shape.kind === 'text' ? approxTextShapeWidth(shape.text ?? '', shape.fontSize ?? SHAPE_TEXT_SIZE_DEFAULT) : shape.width,
      // Loose text is as tall as its own words, which nothing here has
      // measured; a card's own rough constant is the same stand-in the
      // marquee uses, and it is close enough to aim a line at.
      height: shape.kind === 'text' ? SHAPE_TEXT_HEIGHT : shape.kind === 'square' || shape.kind === 'circle' ? shape.width : shape.height,
    });
  }
  // A container is a connectable node too now - "область можна
  // пов'язувати з іншими областями лініями". Its own stored size, not a
  // live-resize one: a resting connection reads this, and the live line
  // (see liveEndpointFor) is what tracks an actual drag or resize.
  for (const container of containers) {
    nodeById.set(container.id, {
      id: container.id,
      x: container.x,
      y: container.y,
      width: container.width,
      height: container.height,
    });
  }

  // Which cards and shapes are geometrically INSIDE a container's own
  // rectangle right now, by each item's CENTRE point - so a thing only
  // half over the edge still counts as belonging wherever its middle
  // actually sits, the same rule a drop onto a column already uses.
  // Called once, at the instant a container starts being dragged (see
  // startContainerDrag) - see BoardContainer's own comment for why this
  // is discovered fresh rather than kept in a stored field.
  function containerMembersAt(container: BoardContainer): { cardIds: Set<string>; shapeIds: Set<string> } {
    const cardIds = new Set<string>();
    const shapeIds = new Set<string>();
    const inside = (node: BoardNode) => {
      const cx = node.x + node.width / 2;
      const cy = node.y + node.height / 2;
      return (
        cx >= container.x &&
        cx <= container.x + container.width &&
        cy >= container.y &&
        cy <= container.y + container.height
      );
    };
    for (const card of cards) {
      const node = nodeById.get(card.id);
      if (node && inside(node)) cardIds.add(card.id);
    }
    for (const shape of shapes) {
      const node = nodeById.get(shape.id);
      if (node && inside(node)) shapeIds.add(shape.id);
    }
    return { cardIds, shapeIds };
  }

  function startContainerDrag(id: string) {
    setDraggingContainerId(id);
    const container = containers.find((c) => c.id === id);
    setContainerDragMembers(container ? containerMembersAt(container) : { cardIds: new Set(), shapeIds: new Set() });
  }

  // The container and every member it was carrying at the start of THIS
  // drag all take the same delta, so nothing has to be recomputed from
  // the container's new origin - unlike a column, a member keeps
  // whatever position it already had relative to the frame, because
  // that relative position was never given up to begin with.
  function commitContainerDrag(id: string, dx: number, dy: number) {
    const { cardIds, shapeIds } = containerDragMembers;
    setContainers((prev) => prev.map((c) => (c.id === id ? { ...c, x: c.x + dx, y: c.y + dy } : c)));
    if (cardIds.size > 0) {
      setCards((prev) => prev.map((c) => (cardIds.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c)));
    }
    if (shapeIds.size > 0) {
      setShapes((prev) => prev.map((sh) => (shapeIds.has(sh.id) ? { ...sh, x: sh.x + dx, y: sh.y + dy } : sh)));
    }
    setDraggingContainerId(null);
    setContainerDragMembers({ cardIds: new Set(), shapeIds: new Set() });
  }

  function liveEndpointFor(node: BoardNode): LiveEndpoint {
    const card = cardById.get(node.id);
    const inGroupDrag = !!card && selectedCardIds.has(node.id);
    const inColumnDrag = !!card?.columnId && card.columnId === draggingColumnId;
    // True for the container itself while it's being dragged, AND for
    // every card/shape riding along with it - same set startContainerDrag
    // snapshotted (see containerDragMembers's own comment).
    const inContainerDrag =
      draggingContainerId !== null &&
      (node.id === draggingContainerId ||
        containerDragMembers.cardIds.has(node.id) ||
        containerDragMembers.shapeIds.has(node.id));
    const position = positionFor(node.id, node.x, node.y);
    return {
      posX: position.x,
      posY: position.y,
      offsetX: inGroupDrag ? groupOffsetX : null,
      offsetY: inGroupDrag ? groupOffsetY : null,
      columnOffsetX: inColumnDrag ? columnOffsetX : null,
      columnOffsetY: inColumnDrag ? columnOffsetY : null,
      containerOffsetX: inContainerDrag ? containerOffsetX : null,
      containerOffsetY: inContainerDrag ? containerOffsetY : null,
      width: node.width,
      height: node.height,
    };
  }

  // Dragging a column moves every card in it, so their links go too.
  const movingCardIds = draggingColumnId
    ? new Set(cards.filter((c) => c.columnId === draggingColumnId).map((c) => c.id))
    : !draggedCardId
      ? null
      : selectedCardIds.has(draggedCardId) && selectedCardIds.size > 1
        ? selectedCardIds
        : new Set([draggedCardId]);
  // Furniture under the finger moves its arrows the same way a card
  // does - it is in the same position registry, so there is nothing
  // special to do beyond saying which one is moving.
  const movingIds =
    draggedShapeId !== null
      ? new Set([...(movingCardIds ?? []), draggedShapeId])
      : movingCardIds;
  // A dragged container moves its own arrows too, and every card/shape
  // riding along with it.
  const containerMovingIds = draggingContainerId
    ? new Set([draggingContainerId, ...containerDragMembers.cardIds, ...containerDragMembers.shapeIds])
    : null;
  const allMovingIds =
    containerMovingIds && movingIds
      ? new Set([...movingIds, ...containerMovingIds])
      : (containerMovingIds ?? movingIds);
  const selectionHasConnections = connections.some(
    (c) => selectedCardIds.has(c.fromCardId) || selectedCardIds.has(c.toCardId)
  );

  // The board's own chrome goes on the DOCK, as on every other screen:
  // the way out, a card on the right, and the canvas tool on the stack's
  // second card. The top capsule and the floating "+" are what that
  // replaces - and the rail's width comes back to a screen that is
  // nothing BUT width.
  useDockLeave('easel-outline', () => navigation.goBack());
  useDockBeads(
    boardFocused
      ? {
          icon: 'layers-outline',
          active: layersDrawerVisible,
          onPress: () => setLayersDrawerVisible((v) => !v),
        }
      : null,
    boardFocused && selectedCardIds.size === 0
      ? { icon: 'add-outline', onPress: () => setAddSheetVisible(true) }
      : null
  );
  // A CARD SELECTION IS AN ACTIONS CARD, the same as on every other
  // database (Documents/Files/Photos/Links) - it used to be its own
  // floating capsule instead, which is what left the dock showing one
  // idle "Рух" button directly above a second, unrelated menu:
  // "у нас впливає ціле окреме меню, і при цьому пустує док з однієї
  // многофункціональної кнопки". The dock already knows how to hold a
  // variable, scrolling list of actions with a word under each icon -
  // this was simply the one screen that had never been moved onto it.
  useDockActions(
    boardFocused
      ? selectedCardIds.size > 0
        ? [
            { key: 'cancel', icon: 'close-outline', label: 'Вийти', onPress: clearSelection },
            ...(selectedCardIds.size >= 2
              ? [
                  {
                    key: 'align',
                    icon: 'mc:align-horizontal-left',
                    label: 'Вирівняти',
                    active: alignMenuVisible,
                    onPress: () => setAlignMenuVisible((v) => !v),
                  },
                ]
              : []),
            ...(onlySelectedCard
              ? [
                  {
                    key: 'copy',
                    icon: 'copy-outline',
                    label: 'Копіювати',
                    onPress: () => copyCardText(onlySelectedCard),
                  },
                ]
              : []),
            ...(onlySelectedDocumentCard
              ? [
                  {
                    key: 'openText',
                    icon: 'reader-outline',
                    label: 'Текст',
                    onPress: () => openCardText(onlySelectedDocumentCard),
                  },
                  {
                    key: 'editDoc',
                    icon: 'create-outline',
                    label: 'Редагувати',
                    onPress: () => editDocumentCard(onlySelectedDocumentCard),
                  },
                ]
              : []),
            ...(selectionHasConnections
              ? [
                  {
                    key: 'disconnect',
                    icon: 'mc:vector-line',
                    label: 'Відʼєднати',
                    onPress: disconnectSelectedCards,
                  },
                ]
              : []),
            ...(onlySelectedImageCard
              ? [
                  {
                    key: 'natural',
                    icon: onlySelectedImageCard.imageNatural ? 'mc:crop-square' : 'mc:image-size-select-actual',
                    label: onlySelectedImageCard.imageNatural ? 'Однакові' : 'Свої пропорції',
                    onPress: () => toggleImageNatural(onlySelectedImageCard),
                  },
                  {
                    key: 'bare',
                    icon: onlySelectedImageCard.imageBare ? 'text-outline' : 'image-outline',
                    label: onlySelectedImageCard.imageBare ? 'З підписом' : 'Без підпису',
                    onPress: () => toggleImageBare(onlySelectedImageCard),
                  },
                ]
              : []),
            { key: 'delete', icon: 'trash-outline', label: 'Видалити', onPress: deleteSelectedCards },
          ]
        : [
            // Three separate buttons now, not one cycled through - "чому
            // їх всі не розмістити на доці? а не проклацувати одну
            // кнопку - це ж нелогічно". The card was already sized for
            // four (ACT_W divides by 4 regardless of count), so the old
            // single button just left three slots sitting empty beside
            // it - every mode was ALREADY drawing the width, none of
            // them were drawing the button.
            {
              key: 'move',
              icon: 'mc:cursor-move',
              label: 'Рух',
              active: canvasTool === 'move',
              onPress: () => setCanvasTool('move'),
            },
            {
              key: 'select',
              icon: 'mc:selection-drag',
              label: 'Вибір',
              active: canvasTool === 'select',
              onPress: () => setCanvasTool('select'),
            },
            {
              key: 'connect',
              icon: 'mc:vector-line',
              label: 'Звʼязок',
              active: canvasTool === 'connect',
              onPress: () => setCanvasTool('connect'),
            },
            // Not a canvasTool, deliberately - it's a lens, not a way of
            // touching the canvas, so it stays lit through 'move' once a
            // chain is picked (see isolatedIds's own comment).
            {
              key: 'isolate',
              icon: 'mc:image-filter-center-focus',
              label: 'Ізоляція',
              active: isolateArmed || isolatedIds !== null,
              onPress: toggleIsolation,
            },
          ]
      : null
  );

  return (
    <View style={styles.splitRoot}>
      {/* The board keeps every pixel it had until a document is opened
          beside it, and all of them again when that document goes full
          screen - hidden rather than unmounted, so the canvas comes back
          at the same pan and zoom. */}
      <View
        style={[styles.container, isTwoPane && paneDocId !== null && paneFullscreen ? styles.paneHidden : null]}
        onLayout={(e) =>
          setViewport({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
        }
      >
        <GestureDetector gesture={canvasGesture}>
          <View ref={canvasRef} style={[StyleSheet.absoluteFill, styles.canvasSurface]}>
            <Animated.View style={[styles.world, worldAnimatedStyle]}>
              {/* Under everything else too - a frame marks a region, it
                  never sits ON top of what it holds. */}
              {containers.filter((frame) => !isHidden(frame)).map((frame) => (
                <DraggableContainer
                  key={frame.id}
                  container={frame}
                  posX={positionFor(frame.id, frame.x, frame.y).x}
                  posY={positionFor(frame.id, frame.x, frame.y).y}
                  isDragging={frame.id === draggingContainerId}
                  dimmed={isolatedIds !== null && !isolatedIds.has(frame.id)}
                  locked={isLocked(frame)}
                  canvasScale={scale}
                  canvasPanGesture={canvasBlockingGesture}
                  containerOffsetX={containerOffsetX}
                  containerOffsetY={containerOffsetY}
                  onDragStart={startContainerDrag}
                  onDragEnd={commitContainerDrag}
                  onRename={(c) => (isolateArmed ? pickIsolationAnchor(c.id) : setRenamingContainer(c))}
                  onDelete={confirmDeleteContainer}
                  onResize={resizeContainer}
                  onStepFontSize={stepContainerTextSize}
                />
              ))}

              {/* Underneath everything - a column is a backdrop its cards sit
                  on. box-none so only the header takes touches and the rest
                  of the lane still pans the canvas. */}
              {columns.map((column) => {
                const members = columnMembers(cards, column.id);
                return (
                  <DraggableColumn
                    key={column.id}
                    column={column}
                    memberCount={members.length}
                    height={columnHeight(members, cardHeights)}
                    isDragging={column.id === draggingColumnId}
                    canvasScale={scale}
                    canvasPanGesture={canvasBlockingGesture}
                    columnOffsetX={columnOffsetX}
                    columnOffsetY={columnOffsetY}
                    isCatching={column.id === hoverColumnId}
                    onDragStart={setDraggingColumnId}
                    onDragEnd={commitColumnDrag}
                    onRename={setRenamingColumn}
                    onDelete={confirmDeleteColumn}
                  />
                );
              })}

              {/* Before the cards, so a link passes UNDER the two cards it
                  joins rather than across their faces. Each connection gets
                  its own small Svg sized to that pair's bounding box - one
                  canvas the size of the whole 6000px world would be a lot to
                  hand the renderer for a handful of thin curves. */}
              {/* THE BOARD'S FURNITURE, between the lanes and the
                  cards: it is drawn ON the canvas, and the cards are the
                  things that live on top of it. */}
              {shapes.filter((shape) => !isHidden(shape)).map((shape) => (
                <DraggableShape
                  key={shape.id}
                  shape={shape}
                  isSelected={shape.id === selectedShapeId}
                  posX={positionFor(shape.id, shape.x, shape.y).x}
                  posY={positionFor(shape.id, shape.x, shape.y).y}
                  onDragStart={setDraggedShapeId}
                  dragEnabled={canvasTool !== 'connect' && !isLocked(shape)}
                  canvasScale={scale}
                  canvasPanGesture={canvasBlockingGesture}
                  canvasHoldGesture={holdToSelectGesture}
                  onTap={(sh) => (isolateArmed ? pickIsolationAnchor(sh.id) : setSelectedShapeId((c) => (c === sh.id ? null : sh.id)))}
                  onLongPress={(sh) => {
                    setSelectedShapeId(sh.id);
                    setEditingShape(sh);
                  }}
                  onDragEnd={(id, x, y) => {
                    setDraggedShapeId(null);
                    moveShape(id, x, y);
                  }}
                  onResize={resizeShape}
                  followsContainerDrag={draggingContainerId !== null && containerDragMembers.shapeIds.has(shape.id)}
                  containerOffsetX={containerOffsetX}
                  containerOffsetY={containerOffsetY}
                  dimmed={isolatedIds !== null && !isolatedIds.has(shape.id)}
                />
              ))}

              {connections.map((connection) => {
                const from = nodeById.get(connection.fromCardId);
                const to = nodeById.get(connection.toCardId);
                if (!from || !to) return null;
                // A line to or from something hidden is itself hidden -
                // nothing to point at otherwise.
                if (isObjectHiddenById(from.id) || isObjectHiddenById(to.id)) return null;
                // While either end is in motion the line is drawn live off
                // the cards' own shared positions instead - the resting
                // curve below is computed from React state, which doesn't
                // update until the drop commits.
                if (allMovingIds && (allMovingIds.has(from.id) || allMovingIds.has(to.id))) {
                  return (
                    <LiveConnectionLine
                      key={connection.id}
                      from={liveEndpointFor(from)}
                      to={liveEndpointFor(to)}
                    />
                  );
                }
                const { x1, y1, x2, y2, vertical } = connectionEndpoints(
                  from.x,
                  from.y,
                  from.width,
                  from.height,
                  to.x,
                  to.y,
                  to.width,
                  to.height
                );
                const left = Math.min(x1, x2) - CONNECTION_PADDING;
                const top = Math.min(y1, y2) - CONNECTION_PADDING;
                const width = Math.abs(x2 - x1) + CONNECTION_PADDING * 2;
                const height = Math.abs(y2 - y1) + CONNECTION_PADDING * 2;
                return (
                  <Svg
                    key={connection.id}
                    style={[styles.connection, { left, top }]}
                    width={width}
                    height={height}
                    pointerEvents="none"
                  >
                    <Path
                      d={curvePath(x1 - left, y1 - top, x2 - left, y2 - top, vertical)}
                      stroke={CONNECTION_COLOR}
                      strokeWidth={2}
                      fill="none"
                    />
                  </Svg>
                );
              })}

              {cards.filter((card) => !isHidden(card)).map((card) => {
                const isSelected = selectedCardIds.has(card.id);
                const position = positionOf(card);
                return (
                  <DraggableCard
                    key={card.id}
                    // Drawn from the record as it is NOW - the same
                    // treatment a document's blocks get, and for the same
                    // reason. A card carries the photo's name as it was
                    // when the card was made, so renaming the photo in its
                    // database changed it everywhere except here.
                    //
                    // Only what is DRAWN is swapped. `cards` is what gets
                    // saved back to the board, and a live value must never
                    // be written into it as though someone had moved or
                    // edited the card.
                    card={applyLiveRecord(card, liveRecords)}
                    posX={position.x}
                    posY={position.y}
                    canvasScale={scale}
                    canvasPanGesture={canvasBlockingGesture}
                    isDragging={card.id === draggedCardId}
                    isSelected={isSelected}
                    isGroupDrag={isSelected && selectedCardIds.size > 1}
                    groupOffsetX={groupOffsetX}
                    groupOffsetY={groupOffsetY}
                    followsColumnDrag={!!card.columnId && card.columnId === draggingColumnId}
                    onHover={reportCardHover}
                    columnOffsetX={columnOffsetX}
                    columnOffsetY={columnOffsetY}
                    followsContainerDrag={draggingContainerId !== null && containerDragMembers.cardIds.has(card.id)}
                    containerOffsetX={containerOffsetX}
                    containerOffsetY={containerOffsetY}
                    allCardBounds={cardBoundsForGuides}
                    guideVX={guideVX}
                    guideVVisible={guideVVisible}
                    guideHY={guideHY}
                    guideHVisible={guideHVisible}
                    dragEnabled={canvasTool !== 'connect' && !isLocked(card)}
                    onMeasure={measureCard}
                    onDragStart={handleDragStart}
                    onDragEnd={commitCardDrag}
                    onGroupDragEnd={commitGroupDrag}
                    onTap={(c) => (isolateArmed ? pickIsolationAnchor(c.id) : handleCardTap(c))}
                    onLongPress={handleCardLongPress}
                    onResize={commitCardResize}
                    canvasHoldGesture={holdToSelectGesture}
                    dimmed={isolatedIds !== null && !isolatedIds.has(card.id)}
                  />
                );
              })}

              {/* The rubber-band line a connect-drag trails behind the
                  finger - live (shared values), so an animated style rather
                  than plain React state. */}
              <ConnectDraftLine
                startX={connectStartX}
                startY={connectStartY}
                endX={connectEndX}
                endY={connectEndY}
                visible={connectVisible}
              />
              {/* On top of every card - a guide has to be seen over
                  whatever it's aligning with. */}
              <AlignmentGuides
                guideVX={guideVX}
                guideVVisible={guideVVisible}
                guideHY={guideHY}
                guideHVisible={guideHVisible}
              />
              <Animated.View style={[styles.marquee, marqueeAnimatedStyle]} pointerEvents="none" />
            </Animated.View>
          </View>
        </GestureDetector>

        {/* Only the board's name stays up here - it needs the width. The
            way back and the tool button stand on the dock with everything
            else. */}
        <View style={styles.headerRow} pointerEvents="box-none">
          <Pressable style={styles.titleTap} onPress={() => setRenamingTitle(true)}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title || 'Без назви'}
            </Text>
          </Pressable>
        </View>

        {/* FURNITURE'S OWN BAR. Separate from the cards' one and never
            shown with it, because the two act on two different lists -
            and that is deliberate: if a shape could join a card
            selection, every bulk action would have to learn to skip it.
            See BoardShape. */}
        {selectedShape && selectedCardIds.size === 0 ? (
          // TWO ROWS, not one long one. A single row here ran wider than
          // even the Fold's OUTER (cover) screen - "розмір панелі ширший
          // за зовнішній фолд" - because it was never one control, it was
          // five: text, a size stepper, fill, eight colour swatches and
          // delete, laid end to end with no wrap and no scroll. The
          // Fold's actual screen (unfolded) has the width to spare, so
          // splitting it in two uses that width instead of demanding
          // ever more of it in one direction.
          <View style={[styles.selectionBarWrap, { bottom: dockClear + bottomInset }]} pointerEvents="box-none">
            <View style={styles.selectionBarCapsule}>
              <View style={styles.selectionBarRow}>
                <Pressable
                  style={styles.selectionBarAction}
                  hitSlop={6}
                  onPress={() => setEditingShape(selectedShape)}
                >
                  <MaterialCommunityIcons name="format-text" size={18} color="#fff" />
                  <Text style={styles.selectionBarActionLabel}>Текст</Text>
                </Pressable>
                {/* A step, not a slider - see SHAPE_TEXT_SIZES. Two taps
                    either side of the label rather than one button, so
                    each press is one clear step instead of a cycle whose
                    current value has to be read off a changing icon. */}
                <View style={styles.textSizeGroup}>
                  <Pressable
                    hitSlop={6}
                    onPress={() => stepShapeTextSize(selectedShape, -1)}
                  >
                    <Ionicons name="remove" size={16} color="#fff" />
                  </Pressable>
                  <Text style={styles.selectionBarActionLabel}>
                    {textSizeStepLabel(selectedShape.fontSize ?? (selectedShape.kind === 'text' ? SHAPE_TEXT_SIZE_DEFAULT : SHAPE_LABEL_SIZE_DEFAULT))}
                  </Text>
                  <Pressable
                    hitSlop={6}
                    onPress={() => stepShapeTextSize(selectedShape, 1)}
                  >
                    <Ionicons name="add" size={16} color="#fff" />
                  </Pressable>
                </View>
                {selectedShape.kind !== 'text' && (
                  <Pressable
                    style={styles.selectionBarAction}
                    hitSlop={6}
                    onPress={() => toggleShapeFilled(selectedShape.id)}
                  >
                    <Ionicons
                      name={selectedShape.filled ? 'color-fill' : 'color-fill-outline'}
                      size={18}
                      color="#fff"
                    />
                    <Text style={styles.selectionBarActionLabel}>Заливка</Text>
                  </Pressable>
                )}
                <View style={styles.selectionBarDivider} />
                <Pressable
                  style={styles.selectionBarAction}
                  hitSlop={6}
                  onPress={() => deleteShape(selectedShape.id)}
                >
                  <Ionicons name="trash-outline" size={18} color="#fff" />
                  <Text style={styles.selectionBarActionLabel}>Видалити</Text>
                </Pressable>
              </View>
              <View style={styles.selectionBarRow}>
                {/* The outline's colour. The first swatch is "no colour" -
                    the theme's own quiet ink, which is what a shape is
                    born with. */}
                <Pressable
                  hitSlop={4}
                  onPress={() => setShapeColour(selectedShape.id, undefined)}
                  style={[
                    styles.shapeSwatch,
                    { borderColor: theme.canvas.inkMuted },
                    !selectedShape.color && styles.shapeSwatchOn,
                  ]}
                />
                {STICKY_COLORS.map((colour) => (
                  <Pressable
                    key={colour}
                    hitSlop={4}
                    onPress={() => setShapeColour(selectedShape.id, colour)}
                    style={[
                      styles.shapeSwatch,
                      { borderColor: colour, backgroundColor: colour },
                      selectedShape.color === colour && styles.shapeSwatchOn,
                    ]}
                  />
                ))}
              </View>
            </View>
          </View>
        ) : null}

        {/* Selection actions moved onto the DOCK's actions card - see
            useDockActions above. This floating capsule used to duplicate
            it, leaving the dock showing one idle button directly above a
            second, unrelated menu. */}

        {/* Align/arrange, opened from the dock's "Вирівняти" action -
            "виділив кілька - «вирівняти по лівому краю / розкласти
            сіткою». Зараз усе руками." A short list rather than seven
            more icons crowding the dock's own action row. */}
        <Menu
          visible={alignMenuVisible}
          onClose={() => setAlignMenuVisible(false)}
          style={{
            position: 'absolute',
            left: windowWidth / 2 - MENU_WIDTH / 2,
            top: windowHeight - dockClear - bottomInset - 340,
          }}
          entries={[
            { kind: 'section', label: 'Вирівняти' },
            { label: 'Ліворуч', icon: 'arrow-back-outline', onPress: () => alignSelectedCards('left') },
            {
              label: 'По центру (гор.)',
              icon: 'swap-horizontal-outline',
              onPress: () => alignSelectedCards('centerX'),
            },
            { label: 'Праворуч', icon: 'arrow-forward-outline', onPress: () => alignSelectedCards('right') },
            { kind: 'rule' },
            { label: 'Вгору', icon: 'arrow-up-outline', onPress: () => alignSelectedCards('top') },
            {
              label: 'По центру (верт.)',
              icon: 'swap-vertical-outline',
              onPress: () => alignSelectedCards('centerY'),
            },
            { label: 'Вниз', icon: 'arrow-down-outline', onPress: () => alignSelectedCards('bottom') },
            { kind: 'rule' },
            { label: 'Розкласти сіткою', icon: 'grid-outline', onPress: arrangeSelectedGrid },
          ]}
        />

        {/* «Меню», where the right button was pressed. Every row calls
            exactly what the selection bar calls - the card is selected
            first, so there is one implementation of each action, not
            two. */}
        <Menu
          visible={!!cardMenu}
          onClose={() => setCardMenu(null)}
          style={{ position: 'absolute', left: cardMenu?.x ?? 0, top: cardMenu?.y ?? 0 }}
          entries={
            cardMenu
              ? [
                  {
                    label: 'Копіювати',
                    icon: 'copy-outline',
                    onPress: () => copyCardText(cardMenu.card),
                  },
                  ...((cardMenu.card.type ?? 'paragraph') === 'document'
                    ? [
                        {
                          label: 'Текст',
                          icon: 'reader-outline' as const,
                          onPress: () => openCardText(cardMenu.card),
                        },
                        {
                          label: 'Редагувати',
                          icon: 'create-outline' as const,
                          onPress: () => editDocumentCard(cardMenu.card),
                        },
                      ]
                    : []),
                  { kind: 'rule' as const },
                  {
                    label: 'Видалити',
                    icon: 'trash-outline',
                    tone: 'danger',
                    onPress: () => deleteCards(new Set([cardMenu.card.id])),
                  },
                ]
              : []
          }
        />

        <Modal
          visible={groupPickerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setGroupPickerVisible(false)}
        >
          <Pressable style={[styles.sheetBackdrop, { paddingBottom: keyboardHeight }]} onPress={() => setGroupPickerVisible(false)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>З якої групи</Text>
              <ScrollView style={styles.groupList}>
                {groups
                  .filter((group) => !group.archived)
                  .map((group) => {
                    const count = itemsByGroup[group.id]?.length ?? 0;
                    return (
                      <Pressable
                        key={group.id}
                        style={styles.sheetRow}
                        onPress={() => {
                          setGroupPickerVisible(false);
                          setImportingGroup(group);
                        }}
                      >
                        <View style={[styles.groupDot, { backgroundColor: group.color || '#6B7280' }]} />
                        <Text style={styles.sheetRowLabel} numberOfLines={1}>
                          {group.name}
                        </Text>
                        <Text style={styles.groupCount}>{count}</Text>
                      </Pressable>
                    );
                  })}
                {groups.filter((group) => !group.archived).length === 0 && (
                  <Text style={styles.groupEmpty}>Поки немає жодної групи.</Text>
                )}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        <GroupImportSheet
          visible={importingGroup !== null}
          groupName={importingGroup?.name ?? ''}
          items={importingGroup ? (itemsByGroup[importingGroup.id] ?? []) : []}
          fixedBoardId={boardId}
          labelForKind={labelForItemKind}
          titleForItem={(item) => titleForItem(item as Parameters<typeof titleForItem>[0])}
          onCancel={() => setImportingGroup(null)}
          onConfirm={(selected) => {
            if (importingGroup) runGroupImport(importingGroup, selected as Parameters<typeof runGroupImport>[1]);
          }}
        />

        <Modal visible={addSheetVisible} transparent animationType="fade" onRequestClose={() => setAddSheetVisible(false)}>
          <Pressable style={[styles.sheetBackdrop, { paddingBottom: keyboardHeight }]} onPress={() => setAddSheetVisible(false)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.sheetHandle} />
              {/* First, because it's the one row that brings a whole
                  theme's worth of material at once rather than one card. */}
              <Pressable
                style={styles.sheetRow}
                onPress={() => {
                  setAddSheetVisible(false);
                  setGroupPickerVisible(true);
                }}
              >
                <Ionicons name="albums-outline" size={18} color="#111827" />
                <Text style={styles.sheetRowLabel}>З групи</Text>
              </Pressable>
              <Pressable style={styles.sheetRow} onPress={addTextCard}>
                <Ionicons name="text-outline" size={18} color="#111827" />
                <Text style={styles.sheetRowLabel}>Текст</Text>
              </Pressable>
              <Pressable style={styles.sheetRow} onPress={createDocumentCard}>
                <Ionicons name="document-text-outline" size={18} color="#111827" />
                <Text style={styles.sheetRowLabel}>Документ</Text>
              </Pressable>
              <Pressable style={styles.sheetRow} onPress={() => openLinkPrompt('other')}>
                <Ionicons name="link-outline" size={18} color="#111827" />
                <Text style={styles.sheetRowLabel}>Посилання</Text>
              </Pressable>
              <Pressable style={styles.sheetRow} onPress={() => openLinkPrompt('video')}>
                <Ionicons name="videocam-outline" size={18} color="#111827" />
                <Text style={styles.sheetRowLabel}>YouTube / TikTok</Text>
              </Pressable>
              <Pressable style={styles.sheetRow} onPress={() => openLinkPrompt('geo')}>
                <Ionicons name="location-outline" size={18} color="#111827" />
                <Text style={styles.sheetRowLabel}>Геоточка</Text>
              </Pressable>
              <Pressable style={styles.sheetRow} onPress={createImageCard}>
                <Ionicons name="image-outline" size={18} color="#111827" />
                <Text style={styles.sheetRowLabel}>Зображення</Text>
              </Pressable>
              <Pressable style={styles.sheetRow} onPress={createFileCard}>
                <Ionicons name="document-outline" size={18} color="#111827" />
                <Text style={styles.sheetRowLabel}>Файл</Text>
              </Pressable>
              <Pressable style={styles.sheetRow} onPress={openExistingItemPicker}>
                <Ionicons name="search-outline" size={18} color="#111827" />
                <Text style={styles.sheetRowLabel}>З бази даних</Text>
              </Pressable>
              {/* Furniture, not content - so it sits at the bottom,
                  below everything that becomes part of a document. */}
              <Pressable
                style={styles.sheetRow}
                onPress={() => {
                  setAddSheetVisible(false);
                  setShapeSheetVisible(true);
                }}
              >
                <MaterialCommunityIcons name="shape-outline" size={18} color="#111827" />
                <Text style={styles.sheetRowLabel}>Фігура або напис</Text>
              </Pressable>
              <Pressable style={styles.sheetRow} onPress={addColumn}>
                <MaterialCommunityIcons name="view-column-outline" size={18} color="#111827" />
                <Text style={styles.sheetRowLabel}>Стовпчик</Text>
              </Pressable>
              <Pressable style={styles.sheetRow} onPress={addContainer}>
                <MaterialCommunityIcons name="selection-drag" size={18} color="#111827" />
                <Text style={styles.sheetRowLabel}>Область</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
        {/* Which piece of furniture. A short list of shapes and one
            loose label - see BoardShape for why none of them is a card. */}
        <Modal
          visible={shapeSheetVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setShapeSheetVisible(false)}
        >
          <Pressable style={styles.sheetBackdrop} onPress={() => setShapeSheetVisible(false)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.sheetHandle} />
              {SHAPE_MENU.map((entry) => (
                <Pressable key={entry.kind} style={styles.sheetRow} onPress={() => addShape(entry.kind)}>
                  <MaterialCommunityIcons
                    name={entry.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                    size={18}
                    color="#111827"
                  />
                  <Text style={styles.sheetRowLabel}>{entry.label}</Text>
                </Pressable>
              ))}
            </Pressable>
          </Pressable>
        </Modal>

        <RenamePrompt
          visible={editingShape !== null}
          title={editingShape?.kind === 'text' ? 'Напис' : 'Текст у фігурі'}
          initialValue={editingShape?.text ?? ''}
          placeholder="Текст"
          multiline
          onCancel={() => setEditingShape(null)}
          onSave={(value) => {
            if (editingShape) setShapeText(editingShape.id, value.trim());
            setEditingShape(null);
          }}
        />


        <AddExistingItemModal
          visible={existingItemPickerVisible}
          onPick={addExistingCard}
          onClose={() => setExistingItemPickerVisible(false)}
          excludeIds={existingItemExcludeIds}
          includeDocuments
          onPickDocument={addDocumentCard}
        />

        <VideoPlayerModal url={playingVideoUrl} onClose={() => setPlayingVideoUrl(null)} />

        <RenamePrompt
          visible={renamingTitle}
          title="Назва дошки"
          initialValue={title}
          onCancel={() => setRenamingTitle(false)}
          onSave={(value) => {
            setRenamingTitle(false);
            setTitle(value);
          }}
        />

        {/* One dialog for both steps of adding a link - see linkPrompt's own
            comment on why they can't be two. */}
        <RenamePrompt
          visible={linkPrompt !== null}
          title={
            linkPrompt?.step === 'title'
              ? 'Назва посилання'
              : linkPrompt?.kind === 'video'
                ? 'Посилання на YouTube / TikTok'
                : linkPrompt?.kind === 'geo'
                  ? 'Посилання на місце'
                  : 'Нове посилання'
          }
          placeholder={linkPrompt?.step === 'title' ? 'Назва' : 'https://…'}
          initialValue=""
          busy={linkPrompt?.step === 'url' && linkPrompt.busy}
          onCancel={() => setLinkPrompt(null)}
          onSave={submitLinkStep}
        />

        <RenamePrompt
          visible={renamingColumn !== null}
          title="Назва стовпчика"
          initialValue={renamingColumn?.title ?? ''}
          onCancel={() => setRenamingColumn(null)}
          onSave={(value) => {
            if (renamingColumn) renameColumn(renamingColumn, value);
          }}
        />

        <RenamePrompt
          visible={renamingContainer !== null}
          title="Назва області"
          initialValue={renamingContainer?.title ?? ''}
          onCancel={() => setRenamingContainer(null)}
          onSave={(value) => {
            if (renamingContainer) renameContainer(renamingContainer, value);
          }}
        />

        <RenamePrompt
          visible={renamingLayer !== null}
          title="Назва шару"
          initialValue={renamingLayer?.name ?? ''}
          onCancel={() => setRenamingLayer(null)}
          onSave={(value) => {
            if (renamingLayer) renameLayerTo(renamingLayer, value);
          }}
        />

        {/* «Шари» - see BoardLayer. NOT built on GlassLayer, on purpose:
            GlassLayer blurs the WHOLE screen behind it AND swallows every
            touch outside its own card to close on tap - both wrong for a
            drawer the user wants open ALONGSIDE a board that stays fully
            usable: "показати на дошці" is pointless if showing it means
            the board went behind a blur, and dragging a card should still
            drag the card, not close the drawer. So this is TagsDrawer's
            own shape instead - a plain dim over the screen, non-touchable
            (pointerEvents="none") so it never competes with the canvas's
            own pan/drag gestures for the same touch - and the blur lives
            only on the panel itself, clipped to its own width. Closing is
            the "Шари" bead again (now a toggle), the drawer's own "×", or
            the hardware back button. */}
        {layersDrawerVisible && (
          <GlassPortal>
            <View style={styles.layersLayer} pointerEvents="box-none">
              <View style={[StyleSheet.absoluteFill, styles.layersDim]} pointerEvents="none" />
              <View style={[styles.layersPanel, { width: Math.min(340, windowWidth * 0.86) }]}>
                <BlurView
                  intensity={60}
                  tint="dark"
                  blurMethod="dimezisBlurView"
                  blurTarget={boardBlurTarget ?? undefined}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                <View style={[StyleSheet.absoluteFill, styles.layersPanelTint]} pointerEvents="none" />
              <View style={styles.layersHeader}>
                <Text style={styles.layersTitle}>Шари</Text>
                <View style={styles.layersHeaderActions}>
                  <Pressable hitSlop={8} onPress={addLayer}>
                    <Ionicons name="add" size={22} color={GLASS_TEXT} />
                  </Pressable>
                  <Pressable hitSlop={8} onPress={() => setLayersDrawerVisible(false)}>
                    <Ionicons name="close" size={22} color={GLASS_TEXT} />
                  </Pressable>
                </View>
              </View>
              <GestureDetector gesture={layersDragGesture}>
                <ScrollView style={styles.layersScroll}>
                  {/* "Без шару": every object nothing has claimed - a bucket,
                      not a real layer, so it has no eye/lock of its own. */}
                  <View
                    ref={layersCarry.registerFolder('')}
                    collapsable={false}
                    style={styles.layerGroup}
                  >
                    <Pressable
                      style={styles.layerHeaderRow}
                      onPress={() => toggleLayerCollapsed('__none__')}
                    >
                      <Ionicons
                        name={collapsedLayerIds.has('__none__') ? 'chevron-forward' : 'chevron-down'}
                        size={16}
                        color={GLASS_TEXT_MUTED}
                      />
                      <Text style={[styles.layerName, { color: GLASS_TEXT_MUTED }]} numberOfLines={1}>
                        Без шару
                      </Text>
                      <Text style={styles.layerCount}>{(layerMembers.get('') ?? []).length}</Text>
                    </Pressable>
                    {!collapsedLayerIds.has('__none__') &&
                      (layerMembers.get('') ?? []).map((member) => renderLayerMemberRow(member))}
                  </View>

                  {layers.map((layer) => (
                    <View
                      key={layer.id}
                      ref={layersCarry.registerFolder(layer.id)}
                      collapsable={false}
                      style={styles.layerGroup}
                    >
                      <View style={styles.layerHeaderRow}>
                        <Pressable hitSlop={6} onPress={() => toggleLayerCollapsed(layer.id)}>
                          <Ionicons
                            name={collapsedLayerIds.has(layer.id) ? 'chevron-forward' : 'chevron-down'}
                            size={16}
                            color={GLASS_TEXT}
                          />
                        </Pressable>
                        <Pressable style={styles.layerNameTap} onPress={() => setRenamingLayer(layer)}>
                          <Text style={styles.layerName} numberOfLines={1}>
                            {layer.name}
                          </Text>
                        </Pressable>
                        <Text style={styles.layerCount}>{(layerMembers.get(layer.id) ?? []).length}</Text>
                        <Pressable hitSlop={6} onPress={() => toggleLayerHidden(layer)}>
                          <Ionicons
                            name={layer.hidden ? 'eye-off-outline' : 'eye-outline'}
                            size={17}
                            color={layer.hidden ? '#F87171' : GLASS_TEXT}
                          />
                        </Pressable>
                        <Pressable hitSlop={6} onPress={() => toggleLayerLocked(layer)}>
                          <Ionicons
                            name={layer.locked ? 'lock-closed' : 'lock-open-outline'}
                            size={17}
                            color={layer.locked ? '#F5C77E' : GLASS_TEXT}
                          />
                        </Pressable>
                        <Pressable hitSlop={6} onPress={() => confirmDeleteLayer(layer)}>
                          <Ionicons name="trash-outline" size={16} color={GLASS_TEXT_MUTED} />
                        </Pressable>
                      </View>
                      {!collapsedLayerIds.has(layer.id) &&
                        (layerMembers.get(layer.id) ?? []).map((member) => renderLayerMemberRow(member))}
                    </View>
                  ))}

                  {layers.length === 0 && (
                    <Text style={styles.layersEmpty}>
                      Ще немає жодного шару. Натисніть «+», щоб створити перший.
                    </Text>
                  )}
                </ScrollView>
              </GestureDetector>
              </View>
            </View>
          </GlassPortal>
        )}
        <CardCarryOverlay
          carry={layersCarry}
          label={(items) => (items[0] ? labelForMember(items[0]) : 'Обʼєкт')}
          icon="layers-outline"
          onEnterFolder={() => {}}
        />

        {/* A plain overlay View sibling of the gesture-driven canvas, not a
            Modal and not a child of the canvas - same reasoning as
            SketchEditor's own text-entry overlay: a Modal here would fight a
            nested Modal (AddExistingItemModal) for focus, and a child of the
            canvas would fight its Pan/Pinch gesture for touch focus. */}
        {readingCard && (
          <View style={styles.textEditBackdrop}>
            <View style={styles.textEditCard}>
              <Text style={styles.readTitle} numberOfLines={1}>
                {readingCard.card.documentTitle?.trim() || 'Текст картки'}
              </Text>
              {/* A read-only input rather than a Text: it can't be edited,
                  but it CAN be selected, which a Text on this canvas
                  cannot. */}
              <ScrollView style={styles.readBody}>
                <TextInput
                  style={styles.textEditInput}
                  value={readingCard.text}
                  editable={false}
                  multiline
                  scrollEnabled={false}
                />
              </ScrollView>
              <View style={styles.textEditButtons}>
                <Pressable style={styles.textEditCancel} onPress={() => setReadingCard(null)}>
                  <Text style={styles.textEditCancelLabel}>Закрити</Text>
                </Pressable>
                <Pressable
                  style={styles.textEditSave}
                  onPress={async () => {
                    await Clipboard.setStringAsync(readingCard.text);
                    hapticSuccess();
                    setReadingCard(null);
                  }}
                >
                  <Text style={styles.textEditSaveLabel}>Копіювати все</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {editingCard && (
          <View style={styles.textEditBackdrop}>
            <View style={styles.textEditCard}>
              <TextInput
                autoFocus
                multiline
                value={editingText}
                onChangeText={setEditingText}
                placeholder="Текст…"
                placeholderTextColor={GLASS_TEXT_FAINT}
                style={styles.textEditInput}
              />
              <View style={styles.textEditColors}>
                {STICKY_COLORS.map((color) => (
                  <Pressable
                    key={color}
                    onPress={() => setEditingCardColor(color)}
                    style={[
                      styles.textEditColorSwatch,
                      // Muted the same way the card will be, or the
                      // swatch promises a colour the board never shows.
                      { backgroundColor: mutedForTheme(color, theme, STICKY_MUTE, theme.canvas.card) },
                      editingCard.color === color && styles.textEditColorSwatchActive,
                    ]}
                  />
                ))}
              </View>
              <View style={styles.textEditButtons}>
                <Pressable style={styles.textEditCancel} onPress={() => setEditingCard(null)}>
                  <Text style={styles.textEditCancelLabel}>Скасувати</Text>
                </Pressable>
                <Pressable style={styles.textEditSave} onPress={saveEditingText}>
                  <Text style={styles.textEditSaveLabel}>Зберегти</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>

      {isTwoPane && paneDocId !== null && (
        <View style={styles.docPane}>
          <DocumentEditorScreen
            key={paneDocId}
            pane
            documentId={paneDocId}
            // This screen's navigation carries the boards stack's own
            // routes as well; the editor only ever pushes root-stack ones
            // (Links/Photos/Files), which a nested navigator forwards
            // upwards at runtime - the cast is purely about the wider
            // param list this prop is typed against.
            navigation={navigation as unknown as NativeStackNavigationProp<RootStackParamList>}
            isFullscreen={paneFullscreen}
            onToggleFullscreen={() => setPaneFullscreen((v) => !v)}
            offerBoard={paneOfferBoard}
            // A clipping made in this pane STAYS in this pane: the board
            // keeps the left half, and the new note opens on the right,
            // so adding it to the board happens in front of the board.
            onOpenInPane={(documentId, options) => {
              setPaneOfferBoard(!!options?.offerBoard);
              setPaneDocId(documentId);
            }}
            onClose={() => {
              setPaneOfferBoard(false);
              setPaneDocId(null);
              setPaneFullscreen(false);
              // The card that opened this pane shows a snapshot of the
              // document (title, text, first image), so it has to be read
              // again now that the document has been edited. Twice: the
              // editor saves on a debounce, and the first read can land
              // before that write is even issued.
              refreshDocumentPreviews();
              setTimeout(refreshDocumentPreviews, 1000);
            }}
          />
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    splitRoot: {
      flex: 1,
      flexDirection: 'row',
    },
    container: {
      flex: 1,
      // The canvas's own ground. It was a flat light grey whatever the
      // theme, which in the black one is one huge bright rectangle the
      // eye has to re-adjust for every time it leaves the board -
      // "її полотно біле а вся загальна тема чорна".
      backgroundColor: theme.canvas.ground,
    },
    paneHidden: {
      display: 'none',
    },
    docPane: {
      flex: 1,
      borderLeftWidth: 1,
      borderLeftColor: 'rgba(17,24,39,0.12)',
      overflow: 'hidden',
    },
    canvasSurface: {
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    world: {
      width: WORLD_SIZE,
      height: WORLD_SIZE,
    },
    // left/top are pinned at 0 on purpose - a card's world position is carried
    // entirely by its animated transform (see DraggableCard), never by layout.
    card: {
      position: 'absolute',
      left: 0,
      top: 0,
      zIndex: 0,
    },
    // The card currently being dragged renders above every other card - see
    // the isDragging comment where this is applied.
    cardDragging: {
      zIndex: 100,
      elevation: 12,
    },
    // The corner a picture is made bigger by. Hangs half off the card, the
    // way the tile board's own grip does, so it never sits on the picture.
    cardGrip: {
      position: 'absolute',
      right: -8,
      bottom: -8,
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(17,24,39,0.85)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.5)',
      zIndex: 30,
    },
    cardSelected: {
      borderRadius: 10,
      borderWidth: 2,
      borderColor: SELECTION_COLOR,
    },
    // FURNITURE. Pinned at 0/0 like a card, for the same reason: the
    // position rides entirely on the animated transform.
    shape: {
      position: 'absolute',
      left: 0,
      top: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    shapeSelected: {
      borderRadius: 6,
      borderWidth: 1,
      borderColor: SELECTION_COLOR,
    },
    // Well in from the edge: a triangle and a diamond have very little
    // room at their points, and words running into the outline read as a
    // mistake rather than as a label.
    shapeTextWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 18,
      paddingVertical: 14,
    },
    // Loose text has no outline to stay clear of.
    shapeTextWrapBare: {
      position: 'relative',
      paddingHorizontal: 4,
      paddingVertical: 4,
    },
    shapeText: {
      // Size comes from the shape itself now (see SHAPE_TEXT_SIZES) - a
      // static default here would win the moment the array below puts
      // it after the inline style.
      fontFamily: FONT_SEMIBOLD,
      textAlign: 'center',
    },
    shapeTextLoose: {
      textAlign: 'left',
    },
    textSizeGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 4,
    },
    shapeSwatch: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
    },
    shapeSwatchOn: {
      borderColor: '#fff',
      borderWidth: 3,
    },
    stickyCard: {
      borderRadius: 8,
      padding: 12,
      minHeight: 90,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    stickyText: {
      fontSize: 14,
      fontFamily: FONT_REGULAR,
      color: theme.canvas.ink,
    },
    dbRowCard: {
      padding: 2,
    },
    refCard: {
      backgroundColor: theme.canvas.card,
      borderRadius: 10,
      padding: 8,
      gap: 6,
      borderWidth: 1,
      // What parts a card from the canvas in the dark - there is
      // nothing darker for the shadow below to fall on.
      borderColor: theme.canvas.edge,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    refThumb: {
      width: '100%',
      height: 90,
      borderRadius: 6,
    },
    // imageBare cards only - no refCard wrapper around this one, so the
    // picture itself carries the card's own rounding and shadow.
    refThumbBare: {
      width: '100%',
      height: 90,
      borderRadius: 10,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    refThumbPlaceholder: {
      backgroundColor: theme.canvas.lane,
      alignItems: 'center',
      justifyContent: 'center',
    },
    refLabel: {
      fontSize: 12,
      fontWeight: '600',
      fontFamily: FONT_SEMIBOLD,
      color: '#111827',
    },
    documentPreviewText: {
      fontSize: 11,
      fontFamily: FONT_REGULAR,
      lineHeight: 15,
      color: theme.canvas.inkMuted,
    },
    headerRow: {
      position: 'absolute',
      top: 56,
      left: 20,
      right: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    titleTap: {
      flex: 1,
      // The app's own glass. No BlurView behind it, deliberately: this
      // screen is INSIDE the blur target, and a blur asked to blur a
      // picture it is itself part of recurses and takes the app down - it
      // did exactly that here. A blurred one would have to be drawn through
      // GlassPortal, like the rail's.
      overflow: 'hidden',
      backgroundColor: GLASS_ISLAND,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.4)',
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    headerTitle: {
      fontSize: 16,
      fontWeight: '700',
      fontFamily: FONT_BOLD,
      color: '#fff',
      textAlign: 'center',
    },
    // `bottom` is set inline (104 + the device's real safe-area inset) -
    // see the component body. Board is a screen inside the "Дошки" tab, so
    // FloatingIslandTabBar's pill (bottom: 24, ~48 tall) is always showing
    // underneath here - 104 is the fixed clearance BulkActionBar's own
    // aboveTabBar variant uses for the same pill.

    marquee: {
      position: 'absolute',
      backgroundColor: 'rgba(37,99,235,0.15)',
      borderWidth: 1.5,
      borderColor: SELECTION_COLOR,
      borderRadius: 4,
    },
    // left/top come from each connection's own bounding box at render time.
    connection: {
      position: 'absolute',
    },
    connectDraft: {
      position: 'absolute',
      left: 0,
      top: 0,
      height: 2,
      backgroundColor: CONNECTION_COLOR,
    },
    // A vertical guide spans the world's own full height, positioned by
    // TRANSLATING it sideways into place - never by setting `left`,
    // which would have to be measured against the current drag every
    // frame instead of riding the same shared value the drag itself
    // writes. Drawn as a dashed BORDER rather than a filled background,
    // the standard lightweight way to get a dashed line out of a plain
    // View - a filled Svg Line would need its own animated-props wiring
    // to follow a Reanimated shared value.
    guideLineV: {
      position: 'absolute',
      left: 0,
      top: 0,
      width: 0,
      height: WORLD_SIZE,
      borderLeftWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: GUIDE_COLOR,
    },
    guideLineH: {
      position: 'absolute',
      left: 0,
      top: 0,
      width: WORLD_SIZE,
      height: 0,
      borderTopWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: GUIDE_COLOR,
    },
    // left/top pinned at 0 on purpose - the column's world position rides
    // entirely on its animated transform, same as a card's.
    column: {
      position: 'absolute',
      left: 0,
      top: 0,
      width: COLUMN_WIDTH,
      borderRadius: 14,
      // A lane ON the canvas, not a card lying on it. It was a 5% dark
      // wash, which over a dark canvas is nothing at all.
      backgroundColor: theme.canvas.lane,
      borderWidth: 1,
      borderColor: theme.canvas.laneEdge,
    },
    // Lit while a card is held over it.
    columnCatching: {
      borderColor: SELECTION_COLOR,
      borderWidth: 2,
      backgroundColor: 'rgba(139,92,246,0.10)',
    },
    columnHeader: {
      height: COLUMN_HEADER_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: COLUMN_PADDING,
    },
    columnTitleWrap: {
      flex: 1,
    },
    columnTitle: {
      fontSize: 13,
      fontWeight: '700',
      fontFamily: FONT_BOLD,
      color: theme.canvas.inkMuted,
    },
    columnCount: {
      fontSize: 11,
      fontFamily: FONT_REGULAR,
      color: theme.canvas.inkFaint,
    },
    // A free-standing frame - see BoardContainer. Genuinely transparent
    // inside (a column's own tint is deliberate; this one exists only to
    // mark a region, never to look like a surface something sits ON).
    frame: {
      position: 'absolute',
      left: 0,
      top: 0,
      borderRadius: 14,
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderColor: theme.canvas.laneEdge,
      borderStyle: 'dashed',
    },
    // Floats just above the frame's own top-left corner, Figma/Miro-style
    // - the only part of it that takes touches is the label pill inside
    // (see DraggableContainer's own comment on why the rest is box-none).
    // Width is SAID inline (see DraggableContainer's own call site) at
    // exactly the frame's own width, never left to a percentage - a
    // maxWidth of '100%' here left the label capped by its OWN
    // hardcoded number well before the row ever reached that limit, so
    // a wide frame sat with room to spare while the name was cut off
    // for no reason: "назва може збільшуватись і відображатись доти
    // поки блок показу розміру тексту не дійде до протилежного краю
    // рамки". With the row's own width said exactly and the stepper
    // pinned to its natural size (flexShrink 0), the label's flexShrink
    // 1 below gives it every point of room the stepper isn't using.
    frameLabelRow: {
      position: 'absolute',
      left: -1,
      top: -CONTAINER_HEADER_HEIGHT,
      height: CONTAINER_HEADER_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    frameLabel: {
      height: CONTAINER_HEADER_HEIGHT,
      minWidth: 64,
      flexShrink: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.canvas.laneEdge,
      backgroundColor: theme.canvas.lane,
    },
    frameLabelText: {
      fontWeight: '700',
      fontFamily: FONT_BOLD,
      color: theme.canvas.inkMuted,
    },
    // The size stepper beside the label - a separate pill on purpose,
    // never nested inside the label's own draggable/tappable area. See
    // textSizeStepLabel for what the number between the buttons means.
    frameSizeStepper: {
      height: CONTAINER_HEADER_HEIGHT,
      flexShrink: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.canvas.laneEdge,
      backgroundColor: theme.canvas.lane,
    },
    frameSizeStepperText: {
      fontSize: 11,
      fontFamily: FONT_REGULAR,
      color: theme.canvas.inkFaint,
      minWidth: 22,
      textAlign: 'center',
    },
    frameDeleteButton: {
      height: CONTAINER_HEADER_HEIGHT,
      width: CONTAINER_HEADER_HEIGHT,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.canvas.laneEdge,
      backgroundColor: theme.canvas.lane,
    },
    // Same compact, content-hugging dark-glass pill as the shared
    // BulkActionBar component (Documents/Files/Photos/Links' own
    // multi-select bar) - kept local rather than reusing that component
    // directly since its action set (tag/group/copy) doesn't apply to board
    // cards. `bottom` is set inline, same as the FAB above.
    selectionBarWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    // A COLUMN now, of rows - see the shape selection bar's own comment
    // for why: one row of every control here ran past even the Fold's
    // narrow outer screen.
    selectionBarCapsule: {
      flexDirection: 'column',
      alignItems: 'center',
      gap: 10,
      backgroundColor: 'rgba(20,20,20,0.55)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.35)',
      borderRadius: 24,
      paddingHorizontal: 16,
      paddingVertical: 10,
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowOffset: { width: 0, height: 6 },
      shadowRadius: 16,
      elevation: 8,
    },
    selectionBarDivider: {
      width: 1,
      height: 22,
      backgroundColor: 'rgba(255,255,255,0.3)',
    },
    selectionBarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
    },
    selectionBarAction: {
      alignItems: 'center',
      gap: 3,
    },
    selectionBarActionLabel: {
      fontSize: 9.5,
      fontWeight: '600',
      fontFamily: FONT_SEMIBOLD,
      color: '#fff',
    },
    // Same dark-glass treatment as the selection bar's own capsule above,
    // for the one confirmation that sits over the canvas itself rather than
    // this app's usual native Alert.
    // «Шари» - a left-anchored drawer, drawn through GlassPortal rather
    // than GlassLayer: the panel carries its own blur (see layersPanel/
    // layersPanelTint below), and everything beside it stays a plain dim
    // (layersDim) rather than the whole screen going behind a blur - the
    // user's own ask was to see the board and the drawer at once.
    layersLayer: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      zIndex: 55,
    },
    layersDim: {
      backgroundColor: 'rgba(17,24,39,0.35)',
    },
    layersPanel: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      overflow: 'hidden',
      borderRightWidth: 1,
      borderRightColor: GLASS_EDGE,
      paddingTop: 56,
      paddingHorizontal: 14,
      paddingBottom: 16,
    },
    // The tint OVER the blur - a blur alone leaves the canvas showing
    // through too sharply for text to sit on; this is what RenamePrompt's
    // own card gets for the same reason, just as an explicit layer here
    // since the panel's own background can't paint over its BlurView
    // child (a parent's fill draws BEHIND what it renders, not on top).
    layersPanelTint: {
      backgroundColor: GLASS_BODY_BLURRED,
    },
    layersHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    layersTitle: {
      fontSize: 20,
      fontFamily: FONT_BOLD,
      color: GLASS_TEXT,
    },
    layersHeaderActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    layersScroll: {
      flex: 1,
    },
    layerGroup: {
      marginBottom: 10,
    },
    layerHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderRadius: 12,
      backgroundColor: GLASS_CARD,
    },
    layerNameTap: {
      flex: 1,
    },
    layerName: {
      flex: 1,
      fontSize: 15,
      fontFamily: FONT_SEMIBOLD,
      color: GLASS_TEXT,
    },
    layerCount: {
      fontSize: 12,
      fontFamily: FONT_REGULAR,
      color: GLASS_TEXT_FAINT,
    },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 7,
      paddingLeft: 26,
      paddingRight: 8,
    },
    // The row of the object currently being dragged - left in place, just
    // faded, the same treatment the kanban card gets while carried.
    memberRowDimmed: {
      opacity: 0.35,
    },
    memberLabel: {
      flex: 1,
      fontSize: 14,
      fontFamily: FONT_REGULAR,
      color: GLASS_TEXT_MUTED,
    },
    layersEmpty: {
      fontSize: 13,
      fontFamily: FONT_REGULAR,
      color: GLASS_TEXT_FAINT,
      textAlign: 'center',
      paddingVertical: 24,
    },
    sheetBackdrop: {
      backgroundColor: 'rgba(17,24,39,0.45)',
      ...SHEET_BACKDROP,
    },
    sheet: {
      backgroundColor: '#fff',
      ...SHEET_WINDOW,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 28,
    },
    sheetTitle: {
      fontSize: 16,
      fontWeight: '700',
      fontFamily: FONT_BOLD,
      color: '#111827',
      marginBottom: 6,
    },
    groupList: {
      maxHeight: 360,
    },
    groupDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    groupCount: {
      fontSize: 13,
      fontFamily: FONT_REGULAR,
      color: '#9CA3AF',
    },
    groupEmpty: {
      fontSize: 14,
      fontFamily: FONT_REGULAR,
      color: '#9CA3AF',
      paddingVertical: 10,
    },
    sheetHandle: {
      width: 36,
      height: 4,
      backgroundColor: '#E5E7EB',
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 12,
    },
    sheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
    },
    sheetRowLabel: {
      flex: 1,
      fontSize: 15,
      fontFamily: FONT_REGULAR,
      color: '#111827',
    },
    textEditBackdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(17,24,39,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    textEditCard: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: '#fff',
      borderRadius: 16,
      padding: 16,
      gap: 12,
    },
    readTitle: {
      fontSize: 15,
      fontWeight: '700',
      fontFamily: FONT_BOLD,
      color: '#111827',
    },
    readBody: {
      maxHeight: 360,
    },
    textEditInput: {
      minHeight: 100,
      fontSize: 15,
      fontFamily: FONT_REGULAR,
      color: '#111827',
      textAlignVertical: 'top',
    },
    textEditColors: {
      flexDirection: 'row',
      gap: 8,
    },
    textEditColorSwatch: {
      width: 26,
      height: 26,
      borderRadius: 13,
    },
    textEditColorSwatchActive: {
      borderWidth: 2,
      borderColor: '#111827',
    },
    textEditButtons: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 12,
    },
    textEditCancel: {
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    textEditCancelLabel: {
      fontSize: 15,
      fontFamily: FONT_REGULAR,
      color: '#6B7280',
    },
    textEditSave: {
      backgroundColor: ACCENT,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 18,
    },
    textEditSaveLabel: {
      fontSize: 15,
      fontWeight: '600',
      fontFamily: FONT_SEMIBOLD,
      color: '#fff',
    },
  });
