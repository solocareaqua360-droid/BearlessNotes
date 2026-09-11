import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
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
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { addDoc, collection, doc, getDoc, getDocFromCache, setDoc, updateDoc } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { BoardsStackParamList, RootStackParamList } from '../navigation';
import { Block, BoardCard, BoardColumn, BoardConnection } from '../types';
import CustomRowBlockCard from '../components/CustomRowBlockCard';
import { hapticDrop, hapticPickUp } from '../utils/haptics';
import {
  APPROX_CARD_HEIGHT,
  COLUMN_CARD_GAP,
  COLUMN_HEADER_HEIGHT,
  COLUMN_MIN_HEIGHT,
  COLUMN_PADDING,
  COLUMN_SPACING,
  COLUMN_WIDTH,
  DEFAULT_CARD_WIDTH,
  WORLD_CENTER,
  WORLD_SIZE,
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
import { boardSections, generateDocumentFromBoard } from '../utils/boardToDocument';
import { stripFormatting } from '../utils/documentPreview';
import DocumentEditorScreen from './DocumentEditorScreen';

const AUTOSAVE_DELAY_MS = 600;
const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
// A large fixed virtual canvas rather than an unbounded one - card x/y are
// plain offsets from this world's own top-left, and the world container
// itself starts centered on screen (see canvasSurface/world styles), so
// WORLD_CENTER is where a freshly created card lands by default.
const STICKY_COLORS = ['#FEF3C7', '#DBEAFE', '#DCFCE7', '#FCE7F3', '#EDE9FE', '#FFE4E6'];
// Cards don't carry their own rendered height (only width) - close enough
// for hit-testing the marquee-selection rectangle against, not meant to be
// pixel-exact.
const SELECTION_COLOR = '#2563EB';
// Kanban columns. A column is exactly wide enough for a default card plus
// its own padding on both sides, so a card dropped in sits flush.
// A column with nothing in it still has to be a visible drop target.
// How far outside a column's own bounds a dropped card still gets pulled
// into it. Generous on purpose - dropping a card "at" a column shouldn't
// require landing inside its box.
const COLUMN_SNAP_MARGIN = 90;
const CONNECTION_COLOR = '#8B5CF6';
// Padding around a connection's own bounding box, so the curve's bulge and
// the stroke width itself aren't clipped by the little Svg canvas each
// connection is drawn into.
const CONNECTION_PADDING = 24;

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
  return cards.filter((c) => c.columnId === columnId).sort((a, b) => a.y - b.y);
}

function columnHeight(members: BoardCard[], heights: Map<string, number>): number {
  const filled = members.reduce((sum, card) => sum + heightOf(card, heights) + COLUMN_CARD_GAP, 0);
  return Math.max(COLUMN_MIN_HEIGHT, COLUMN_HEADER_HEIGHT + filled + COLUMN_PADDING);
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
  y: number
): BoardColumn | undefined {
  let best: BoardColumn | undefined;
  let bestDistance = COLUMN_SNAP_MARGIN;
  for (const column of columns) {
    const height = columnHeight(columnMembers(cards, column.id), heights);
    // Distance from the point to the column's rectangle - zero anywhere
    // inside it, so a card actually dropped in always wins.
    const dx = Math.max(column.x - x, 0, x - (column.x + COLUMN_WIDTH));
    const dy = Math.max(column.y - y, 0, y - (column.y + height));
    const distance = Math.sqrt(dx * dx + dy * dy);
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
  const slots = new Map<string, { x: number; y: number }>();
  for (const column of columns) {
    const members = columnMembers(cards, column.id);
    // Until every card in the column has reported its height, leave the
    // column alone: the positions it was saved with are already correct,
    // and laying it out against the fallback constant would visibly yank
    // every card the moment the board opened, only to correct itself a
    // frame later once the real measurements arrived.
    if (members.some((card) => !heights.has(card.id))) continue;
    let y = column.y + COLUMN_HEADER_HEIGHT;
    for (const card of members) {
      slots.set(card.id, { x: column.x + COLUMN_PADDING, y });
      y += heightOf(card, heights) + COLUMN_CARD_GAP;
    }
  }
  let changed = false;
  const next = cards.map((card) => {
    const slot = slots.get(card.id);
    if (slot) {
      if (card.x === slot.x && card.y === slot.y) return card;
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
function connectionEndpoints(from: BoardCard, to: BoardCard, heights: Map<string, number>) {
  const fromCenterX = from.x + from.width / 2;
  const toCenterX = to.x + to.width / 2;
  const fromIsLeft = fromCenterX <= toCenterX;
  return {
    x1: fromIsLeft ? from.x + from.width : from.x,
    // The measured height, matching what LiveConnectionLine uses - taking
    // the rough constant here instead would make the line jump vertically
    // the moment a drag ended on any card that isn't exactly that tall.
    y1: from.y + heightOf(from, heights) / 2,
    x2: fromIsLeft ? to.x : to.x + to.width,
    y2: to.y + heightOf(to, heights) / 2,
  };
}

// A mindmap S-curve: control points pushed straight out sideways from each
// end, so the line leaves and arrives horizontally regardless of the
// vertical distance between the two cards.
function curvePath(x1: number, y1: number, x2: number, y2: number): string {
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
  const animatedStyle = useAnimatedStyle(() => {
    const fromX = from.posX.value + (from.offsetX?.value ?? 0) + (from.columnOffsetX?.value ?? 0);
    const fromY = from.posY.value + (from.offsetY?.value ?? 0) + (from.columnOffsetY?.value ?? 0);
    const toX = to.posX.value + (to.offsetX?.value ?? 0) + (to.columnOffsetX?.value ?? 0);
    const toY = to.posY.value + (to.offsetY?.value ?? 0) + (to.columnOffsetY?.value ?? 0);

    // Same "leave from the side that faces the other card" rule the
    // resting curve uses, so the line doesn't jump sides on release.
    const fromIsLeft = fromX + from.width / 2 <= toX + to.width / 2;
    const x1 = fromIsLeft ? fromX + from.width : fromX;
    const y1 = fromY + from.height / 2;
    const x2 = fromIsLeft ? toX : toX + to.width;
    const y2 = toY + to.height / 2;

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
  canvasScale: SharedValue<number>;
  canvasPanGesture: ReturnType<typeof Gesture.Pan>;
  columnOffsetX: SharedValue<number>;
  columnOffsetY: SharedValue<number>;
  onDragStart: (id: string) => void;
  onDragEnd: (id: string, dx: number, dy: number) => void;
  onRename: (column: BoardColumn) => void;
  onDelete: (column: BoardColumn) => void;
}) {
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
    <Animated.View style={[styles.column, { height }, animatedStyle]} pointerEvents="box-none">
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
  onGroupDragEnd: (dx: number, dy: number) => void;
  onTap: (card: BoardCard) => void;
  onLongPress: (card: BoardCard) => void;
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
  isGroupDrag,
  groupOffsetX,
  groupOffsetY,
  followsColumnDrag,
  columnOffsetX,
  columnOffsetY,
  dragEnabled,
  onMeasure,
  onDragStart,
  onDragEnd,
  onGroupDragEnd,
  onTap,
  onLongPress,
}: DraggableCardProps) {
  // The last position this card itself put into the parent's state. Used
  // only to tell "our own drag echoing back" (ignore) apart from a real
  // external move (adopt).
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
      }
    })
    .onEnd(() => {
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

  const longPressGesture = Gesture.LongPress()
    .minDuration(500)
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
          (followsColumnDrag ? columnOffsetX.value : 0),
      },
      {
        translateY:
          posY.value +
          (isSelected ? groupOffsetY.value : 0) +
          (followsColumnDrag ? columnOffsetY.value : 0),
      },
    ],
  }));

  const type = card.type ?? 'paragraph';

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        onLayout={(e) => onMeasure(card.id, e.nativeEvent.layout.height)}
        style={[
          styles.card,
          { width: card.width },
          // A plain (non-animated) style, not part of useAnimatedStyle -
          // isDragging only flips twice per drag (start/end), not per
          // frame, so it doesn't need to live on the UI thread. Elevation
          // is Android's own stacking mechanism (zIndex alone isn't always
          // enough there for sibling Views to reorder above one another).
          isDragging && styles.cardDragging,
          isSelected && styles.cardSelected,
          animatedStyle,
        ]}
      >
        {type === 'document' ? (
          <View style={styles.refCard}>
            {!card.documentExpanded &&
              (card.documentPreviewImageUri ? (
                <Image source={{ uri: card.documentPreviewImageUri }} style={styles.refThumb} resizeMode="cover" />
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
          <View style={[styles.stickyCard, { backgroundColor: card.color ?? STICKY_COLORS[0] }]}>
            <Text style={styles.stickyText} numberOfLines={6}>
              {card.text || 'Порожня картка'}
            </Text>
          </View>
        ) : type === 'image' ? (
          <View style={styles.refCard}>
            {card.imageUri ? (
              <Image source={{ uri: card.imageUri }} style={styles.refThumb} resizeMode="cover" />
            ) : (
              <View style={[styles.refThumb, styles.refThumbPlaceholder]}>
                <Ionicons name="image-outline" size={22} color="#9CA3AF" />
              </View>
            )}
            <Text style={styles.refLabel} numberOfLines={2}>
              {card.imageTitle || 'Без назви'}
            </Text>
          </View>
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
              <Image source={{ uri: card.linkImageUrl }} style={styles.refThumb} resizeMode="cover" />
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
  // The document generated from this board, if there is one - see
  // boardToDocument.ts. Stored on the board itself, so it survives a
  // reopen and the document can find its way back here.
  const [generatedDocId, setGeneratedDocId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  // The board read as the document it adds up to: same cards, same order,
  // stacked vertically instead of spread over a canvas. Not a separate
  // copy of anything - it renders the very cards the canvas does, through
  // the same boardSections() the generated document is built from, so what
  // you read here is what you get on export.
  const [outlineMode, setOutlineMode] = useState(false);
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

  const [title, setTitle] = useState('');
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [existingItemPickerVisible, setExistingItemPickerVisible] = useState(false);
  const [editingCard, setEditingCard] = useState<BoardCard | null>(null);
  const [editingText, setEditingText] = useState('');
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);
  // 'move' - single-finger drag pans the canvas (the original Stage 1
  // behaviour). 'select' - single-finger drag instead draws a marquee
  // rectangle over the world, selecting every card it overlaps, so several
  // cards can be deleted or dragged as one group.
  // 'connect' - a single-finger drag from one card to another links them
  // with a mindmap line instead of panning or selecting.
  const [canvasTool, setCanvasTool] = useState<'move' | 'select' | 'connect'>('move');
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [connections, setConnections] = useState<BoardConnection[]>([]);
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  // Each card's real rendered height, reported by its own onLayout - what
  // a column stacks by. State rather than a ref specifically so a height
  // change re-renders: a column whose single card grew has nothing to
  // reposition, but its OWN height still has to catch up.
  const [cardHeights, setCardHeights] = useState<Map<string, number>>(new Map());
  const [renamingColumn, setRenamingColumn] = useState<BoardColumn | null>(null);
  const [deletingColumn, setDeletingColumn] = useState<BoardColumn | null>(null);
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

  function positionOf(card: BoardCard) {
    const existing = cardPositions.current.get(card.id);
    if (existing) return existing;
    const created = { x: makeMutable(card.x), y: makeMutable(card.y) };
    cardPositions.current.set(card.id, created);
    return created;
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
      setTitle(data?.title ?? 'Без назви');
      setCards(data?.cards ?? []);
      setConnections(data?.connections ?? []);
      setColumns(data?.columns ?? []);
      setGeneratedDocId(data?.documentId ?? null);
      setIsLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  useEffect(() => {
    if (!isLoaded) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setDoc(
        doc(db, 'boards', boardId),
        { title, cards, connections, columns, updatedAt: Date.now() },
        { merge: true }
      );
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, cards, connections, columns, isLoaded]);

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

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const panGesture = Gesture.Pan()
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

  function beginConnection(worldX: number, worldY: number) {
    const source = cardAt(worldX, worldY);
    connectingFromIdRef.current = source ? source.id : null;
  }

  function finishConnection(worldX: number, worldY: number) {
    const fromId = connectingFromIdRef.current;
    connectingFromIdRef.current = null;
    if (!fromId) return;
    const target = cardAt(worldX, worldY);
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
  const canvasGesture =
    canvasTool === 'select'
      ? selectGesture
      : canvasTool === 'connect'
        ? connectGesture
        : Gesture.Simultaneous(pinchGesture, panGesture);

  const marqueeAnimatedStyle = useAnimatedStyle(() => ({
    opacity: marqueeVisible.value ? 1 : 0,
    left: Math.min(marqueeStartX.value, marqueeCurrentX.value),
    top: Math.min(marqueeStartY.value, marqueeCurrentY.value),
    width: Math.abs(marqueeCurrentX.value - marqueeStartX.value),
    height: Math.abs(marqueeCurrentY.value - marqueeStartY.value),
  }));

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
    Alert.alert('Нове зображення', undefined, [
      { text: 'Галерея', onPress: () => pickImage('gallery') },
      { text: 'Камера', onPress: () => pickImage('camera') },
      { text: 'Скасувати', style: 'cancel' },
    ]);
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
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const imageUri = await compressPickedImage(asset.uri, asset.width, asset.height);
    const id = generateId();
    const now = Date.now();
    await setDoc(
      doc(db, 'photos', id),
      { imageUri, imageFit: 'contain', createdAt: now, updatedAt: now, usedInDocuments: {} },
      { merge: true }
    );
    backupFileToDrive(imageUri, `${id}.jpg`, 'image/jpeg', 'Photos').then((uploaded) => {
      if (uploaded) updateDoc(doc(db, 'photos', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
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
      if (uploaded) updateDoc(doc(db, 'files', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
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

  // Arriving from the document's own "show the board" button: the document
  // that sent us here opens beside the board it came from.
  useEffect(() => {
    if (openDocumentId && isTwoPane) setPaneDocId(openDocumentId);
  }, [openDocumentId, isTwoPane]);

  // Builds the document this board adds up to - columns as headings, cards
  // as blocks, in reading order. Run a second time it rewrites the same
  // document rather than making another, which is why it warns first: a
  // rebuild replaces whatever was edited in the document by hand.
  async function buildBoardDocument() {
    if (generating) return;
    setGenerating(true);
    try {
      const id = await generateDocumentFromBoard({
        id: boardId,
        title,
        cards,
        connections,
        columns,
        documentId: generatedDocId ?? undefined,
        createdAt: 0,
        updatedAt: 0,
      });
      setGeneratedDocId(id);
      if (isTwoPane) setPaneDocId(id);
      else navigation.navigate('EditorModal', { documentId: id });
    } finally {
      setGenerating(false);
    }
  }

  function confirmBuildBoardDocument() {
    if (!generatedDocId) {
      Alert.alert('Сформувати документ', 'Колонки стануть заголовками, картки - блоками, у тому ж порядку.', [
        { text: 'Скасувати', style: 'cancel' },
        { text: 'Сформувати', onPress: buildBoardDocument },
      ]);
      return;
    }
    Alert.alert(
      'Документ уже сформовано',
      'Оновити його з поточної дошки? Правки, зроблені в самому документі, будуть замінені.',
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Відкрити',
          onPress: () =>
            isTwoPane
              ? setPaneDocId(generatedDocId)
              : navigation.navigate('EditorModal', { documentId: generatedDocId }),
        },
        { text: 'Оновити', style: 'destructive', onPress: buildBoardDocument },
      ]
    );
  }

  // Moving a card one place up or down in reading order. Inside a column
  // that's a swap of the two cards' y (the column's own stacking recomputes
  // the real positions from that order - see reflowColumns); at a column's
  // edge it hands the card to the neighbouring column instead, which is
  // the same move a drag across the canvas would make.
  function moveCardInOutline(cardId: string, delta: -1 | 1) {
    setCards((prev) => {
      const sections = boardSections({ cards: prev, columns });
      const sectionIndex = sections.findIndex((s) => s.cards.some((c) => c.id === cardId));
      if (sectionIndex < 0) return prev;
      const section = sections[sectionIndex];
      const index = section.cards.findIndex((c) => c.id === cardId);
      const neighbour = section.cards[index + delta];

      if (neighbour) {
        return prev.map((card) => {
          if (card.id === cardId) return { ...card, y: neighbour.y };
          if (card.id === neighbour.id) return { ...card, y: section.cards[index].y };
          return card;
        });
      }

      // Past the end of this section: the next one, if there is one.
      const target = sections[sectionIndex + delta];
      if (!target) return prev;
      const edgeY =
        target.cards.length === 0
          ? 0
          : delta === 1
            ? Math.min(...target.cards.map((c) => c.y)) - 1
            : Math.max(...target.cards.map((c) => c.y)) + 1;
      return prev.map((card) => {
        if (card.id !== cardId) return card;
        if (target.columnId === null) {
          // Into the loose section: the key is dropped rather than set to
          // undefined, which Firestore rejects outright.
          const { columnId: _columnId, ...rest } = card;
          return { ...rest, y: edgeY };
        }
        return { ...card, columnId: target.columnId, y: edgeY };
      });
    });
  }

  // One line of the outline: what this card would read as in the document.
  function outlineCardLabel(card: BoardCard): string {
    if (card.type === 'document') return card.documentTitle?.trim() || 'Документ';
    if (card.type === 'link') return card.linkTitle?.trim() || card.linkUrl || 'Посилання';
    if (card.type === 'image') return card.imageTitle?.trim() || 'Зображення';
    if (card.type === 'file') return card.fileTitle?.trim() || 'Файл';
    const text = stripFormatting(card.text ?? '').trim();
    return text || 'Порожня картка';
  }

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

  function commitCardDrag(id: string, x: number, y: number) {
    setCards((prev) => {
      const dropped = prev.map((c) => (c.id === id ? { ...c, x, y } : c));
      const card = dropped.find((c) => c.id === id);
      if (!card) return dropped;
      // Hit-tested against the OTHER cards' membership, so a card being
      // dragged out of a column doesn't count itself towards that column's
      // height while deciding whether it landed back inside it.
      const others = dropped.filter((c) => c.id !== id);
      const centreY = y + heightOf(card, cardHeights) / 2;
      const target = columnAtPoint(columns, others, cardHeights, x + card.width / 2, centreY);
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

  // A custom glass-capsule confirm rather than the native Alert used for
  // every OTHER destructive confirmation on this screen (single/multi-card
  // delete) - this one specifically sits over the canvas next to the
  // column itself, where the native dialog's plain white system look
  // stood out against the board's own dark-glass chrome.
  function confirmDeleteColumn(column: BoardColumn) {
    setDeletingColumn(column);
  }

  function deleteColumn() {
    if (!deletingColumn) return;
    // Cards keep the position the column had them in - the reflow effect
    // below strips the now-dangling columnId when `columns` changes.
    setColumns((prev) => prev.filter((c) => c.id !== deletingColumn.id));
    setDeletingColumn(null);
  }

  // Long-pressing a card selects just that one, which surfaces the same
  // bottom action bar the marquee/select tool uses for a multi-card
  // selection - "Редагувати" for a lone document card, "Видалити" either
  // way - rather than jumping straight to a delete confirmation.
  function handleCardLongPress(card: BoardCard) {
    setSelectedCardIds(new Set([card.id]));
  }

  function deleteSelectedCards() {
    const count = selectedCardIds.size;
    Alert.alert(count === 1 ? 'Видалити картку?' : `Видалити картки (${count})?`, undefined, [
      { text: 'Скасувати', style: 'cancel' },
      {
        text: 'Видалити',
        style: 'destructive',
        onPress: () => {
          // Reflowed after the removal so a column closes the gap its
          // deleted card left behind.
          setCards((prev) =>
            reflowColumns(
              prev.filter((c) => !selectedCardIds.has(c.id)),
              columns,
              cardHeights
            )
          );
          // A connection to a card that no longer exists would render as a
          // line into empty space, so they go with it.
          setConnections((prev) =>
            prev.filter((c) => !selectedCardIds.has(c.fromCardId) && !selectedCardIds.has(c.toCardId))
          );
          setSelectedCardIds(new Set());
        },
      },
    ]);
  }

  function disconnectSelectedCards() {
    setConnections((prev) =>
      prev.filter((c) => !selectedCardIds.has(c.fromCardId) && !selectedCardIds.has(c.toCardId))
    );
    setSelectedCardIds(new Set());
  }

  function toggleCanvasTool() {
    setCanvasTool((prev) => (prev === 'move' ? 'select' : prev === 'select' ? 'connect' : 'move'));
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

  const cardById = new Map(cards.map((c) => [c.id, c]));
  // A dragged card's live position lives in its own shared values, which
  // the connection lines (drawn from React state) can't see - so rather
  // than leave a line anchored to where the card WAS for the length of the
  // drag, its links are hidden outright and come back correctly shaped
  // once the drop commits the new position. A group drag moves every
  // selected card, so all of their links go too.
  // Which shared offsets currently apply to this card, so a live line can
  // add exactly the same ones the card's own animated style does.
  function liveEndpointFor(card: BoardCard): LiveEndpoint {
    const inGroupDrag = selectedCardIds.has(card.id);
    const inColumnDrag = !!card.columnId && card.columnId === draggingColumnId;
    const position = positionOf(card);
    return {
      posX: position.x,
      posY: position.y,
      offsetX: inGroupDrag ? groupOffsetX : null,
      offsetY: inGroupDrag ? groupOffsetY : null,
      columnOffsetX: inColumnDrag ? columnOffsetX : null,
      columnOffsetY: inColumnDrag ? columnOffsetY : null,
      width: card.width,
      height: heightOf(card, cardHeights),
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
  const selectionHasConnections = connections.some(
    (c) => selectedCardIds.has(c.fromCardId) || selectedCardIds.has(c.toCardId)
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
          <View style={[StyleSheet.absoluteFill, styles.canvasSurface]}>
            <Animated.View style={[styles.world, worldAnimatedStyle]}>
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
              {connections.map((connection) => {
                const from = cardById.get(connection.fromCardId);
                const to = cardById.get(connection.toCardId);
                if (!from || !to) return null;
                // While either end is in motion the line is drawn live off
                // the cards' own shared positions instead - the resting
                // curve below is computed from React state, which doesn't
                // update until the drop commits.
                if (movingCardIds && (movingCardIds.has(from.id) || movingCardIds.has(to.id))) {
                  return (
                    <LiveConnectionLine
                      key={connection.id}
                      from={liveEndpointFor(from)}
                      to={liveEndpointFor(to)}
                    />
                  );
                }
                const { x1, y1, x2, y2 } = connectionEndpoints(from, to, cardHeights);
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
                      d={curvePath(x1 - left, y1 - top, x2 - left, y2 - top)}
                      stroke={CONNECTION_COLOR}
                      strokeWidth={2}
                      fill="none"
                    />
                  </Svg>
                );
              })}

              {cards.map((card) => {
                const isSelected = selectedCardIds.has(card.id);
                const position = positionOf(card);
                return (
                  <DraggableCard
                    key={card.id}
                    card={card}
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
                    columnOffsetX={columnOffsetX}
                    columnOffsetY={columnOffsetY}
                    dragEnabled={canvasTool !== 'connect'}
                    onMeasure={measureCard}
                    onDragStart={handleDragStart}
                    onDragEnd={commitCardDrag}
                    onGroupDragEnd={commitGroupDrag}
                    onTap={handleCardTap}
                    onLongPress={handleCardLongPress}
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
              <Animated.View style={[styles.marquee, marqueeAnimatedStyle]} pointerEvents="none" />
            </Animated.View>
          </View>
        </GestureDetector>

        {outlineMode && (
          // Over the canvas rather than instead of it: the canvas keeps its
          // pan, its zoom and every measured card height, so switching back
          // lands exactly where it was left.
          <ScrollView style={styles.outline} contentContainerStyle={styles.outlineContent}>
            {boardSections({ cards, columns }).map((section, sectionIndex) => (
              <View key={section.columnId ?? 'loose'} style={styles.outlineSection}>
                <Text style={styles.outlineHeading}>{section.title ?? 'Поза колонками'}</Text>
                {section.cards.length === 0 && <Text style={styles.outlineEmpty}>Порожня колонка</Text>}
                {section.cards.map((card, index) => (
                  <View key={card.id} style={styles.outlineRow}>
                    <Ionicons
                      name={
                        card.type === 'document'
                          ? 'document-text-outline'
                          : card.type === 'link'
                            ? 'link-outline'
                            : card.type === 'image'
                              ? 'image-outline'
                              : card.type === 'file'
                                ? 'document-attach-outline'
                                : 'ellipse-outline'
                      }
                      size={16}
                      color="#6B7280"
                    />
                    <Pressable
                      style={styles.outlineLabelTap}
                      onPress={() => (card.type === 'document' ? editDocumentCard(card) : undefined)}
                    >
                      <Text style={styles.outlineLabel} numberOfLines={2}>
                        {outlineCardLabel(card)}
                      </Text>
                    </Pressable>
                    <Pressable
                      hitSlop={6}
                      style={styles.outlineMove}
                      disabled={sectionIndex === 0 && index === 0}
                      onPress={() => moveCardInOutline(card.id, -1)}
                    >
                      <Ionicons
                        name="chevron-up"
                        size={18}
                        color={sectionIndex === 0 && index === 0 ? '#D1D5DB' : '#6B7280'}
                      />
                    </Pressable>
                    <Pressable hitSlop={6} style={styles.outlineMove} onPress={() => moveCardInOutline(card.id, 1)}>
                      <Ionicons name="chevron-down" size={18} color="#6B7280" />
                    </Pressable>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        )}

        <View style={styles.headerRow} pointerEvents="box-none">
          <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color="#111827" />
          </Pressable>
          <Pressable style={styles.titleTap} onPress={() => setRenamingTitle(true)}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title || 'Без назви'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toolButton, outlineMode && styles.toolButtonActive]}
            onPress={() => setOutlineMode((v) => !v)}
          >
            <Ionicons name="list-outline" size={20} color={outlineMode ? '#fff' : '#111827'} />
          </Pressable>
          <Pressable style={styles.toolButton} onPress={confirmBuildBoardDocument}>
            <Ionicons
              name={generatedDocId ? 'document-text' : 'document-text-outline'}
              size={20}
              color="#111827"
            />
          </Pressable>
          {/* One button cycling move -> select -> connect, each with its own
              icon, rather than three buttons crowding the header. */}
          <Pressable
            style={[styles.toolButton, canvasTool !== 'move' && styles.toolButtonActive]}
            onPress={toggleCanvasTool}
          >
            <MaterialCommunityIcons
              name={
                canvasTool === 'select' ? 'selection-drag' : canvasTool === 'connect' ? 'vector-line' : 'cursor-move'
              }
              size={20}
              color={canvasTool !== 'move' ? '#fff' : '#111827'}
            />
          </Pressable>
        </View>

        {selectedCardIds.size > 0 ? (
          // Compact, content-hugging, centred capsule - same look as the
          // shared BulkActionBar component (Documents/Files/Photos/Links'
          // own multi-select bar), kept local rather than reusing that
          // component directly since its action set (tag/group/copy)
          // doesn't apply to board cards.
          <View style={[styles.selectionBarWrap, { bottom: 104 + bottomInset }]} pointerEvents="box-none">
            <View style={styles.selectionBarCapsule}>
              <Text style={styles.selectionBarCount}>{selectedCardIds.size}</Text>
              <View style={styles.selectionBarDivider} />
              {onlySelectedDocumentCard && (
                <Pressable
                  style={styles.selectionBarAction}
                  hitSlop={6}
                  onPress={() => editDocumentCard(onlySelectedDocumentCard)}
                >
                  <Ionicons name="create-outline" size={18} color="#fff" />
                  <Text style={styles.selectionBarActionLabel}>Редагувати</Text>
                </Pressable>
              )}
              {selectionHasConnections && (
                <Pressable style={styles.selectionBarAction} hitSlop={6} onPress={disconnectSelectedCards}>
                  <MaterialCommunityIcons name="vector-line" size={18} color="#fff" />
                  <Text style={styles.selectionBarActionLabel}>Відʼєднати</Text>
                </Pressable>
              )}
              <Pressable style={styles.selectionBarAction} hitSlop={6} onPress={() => setSelectedCardIds(new Set())}>
                <Ionicons name="close" size={18} color="#fff" />
                <Text style={styles.selectionBarActionLabel}>Скасувати</Text>
              </Pressable>
              <Pressable style={styles.selectionBarAction} hitSlop={6} onPress={deleteSelectedCards}>
                <Ionicons name="trash-outline" size={18} color="#fff" />
                <Text style={styles.selectionBarActionLabel}>Видалити</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={[styles.fab, { bottom: 104 + bottomInset }]} onPress={() => setAddSheetVisible(true)}>
            <Ionicons name="add" size={26} color="#fff" />
          </Pressable>
        )}

        <Modal visible={addSheetVisible} transparent animationType="fade" onRequestClose={() => setAddSheetVisible(false)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setAddSheetVisible(false)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.sheetHandle} />
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
              <Pressable style={styles.sheetRow} onPress={addColumn}>
                <MaterialCommunityIcons name="view-column-outline" size={18} color="#111827" />
                <Text style={styles.sheetRowLabel}>Стовпчик</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>

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

        <Modal
          visible={deletingColumn !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setDeletingColumn(null)}
        >
          <Pressable style={styles.glassConfirmBackdrop} onPress={() => setDeletingColumn(null)}>
            <Pressable style={styles.glassConfirmCard} onPress={() => {}}>
              <Text style={styles.glassConfirmTitle}>Видалити стовпчик?</Text>
              <Text style={styles.glassConfirmBody}>Картки з нього залишаться на дошці.</Text>
              <View style={styles.glassConfirmButtons}>
                <Pressable style={styles.glassConfirmButton} onPress={() => setDeletingColumn(null)}>
                  <Text style={styles.glassConfirmButtonLabel}>Скасувати</Text>
                </Pressable>
                <Pressable
                  style={[styles.glassConfirmButton, styles.glassConfirmButtonDanger]}
                  onPress={deleteColumn}
                >
                  <Text style={styles.glassConfirmButtonLabel}>Видалити</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* A plain overlay View sibling of the gesture-driven canvas, not a
            Modal and not a child of the canvas - same reasoning as
            SketchEditor's own text-entry overlay: a Modal here would fight a
            nested Modal (AddExistingItemModal) for focus, and a child of the
            canvas would fight its Pan/Pinch gesture for touch focus. */}
        {editingCard && (
          <View style={styles.textEditBackdrop}>
            <View style={styles.textEditCard}>
              <TextInput
                autoFocus
                multiline
                value={editingText}
                onChangeText={setEditingText}
                placeholder="Текст…"
                style={styles.textEditInput}
              />
              <View style={styles.textEditColors}>
                {STICKY_COLORS.map((color) => (
                  <Pressable
                    key={color}
                    onPress={() => setEditingCardColor(color)}
                    style={[
                      styles.textEditColorSwatch,
                      { backgroundColor: color },
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
            onClose={() => {
              setPaneDocId(null);
              setPaneFullscreen(false);
            }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  splitRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
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
  cardSelected: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: SELECTION_COLOR,
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
    color: '#111827',
  },
  dbRowCard: {
    padding: 2,
  },
  refCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
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
  refThumbPlaceholder: {
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111827',
  },
  documentPreviewText: {
    fontSize: 11,
    lineHeight: 15,
    color: '#6B7280',
  },
  outline: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#F3F4F6',
  },
  outlineContent: {
    // Clear of the header capsule above (top: 56 plus its own height) and
    // of the floating tab bar below.
    paddingTop: 104,
    paddingHorizontal: 20,
    paddingBottom: 160,
    gap: 18,
  },
  outlineSection: {
    gap: 6,
  },
  outlineHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  outlineEmpty: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  outlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  outlineLabelTap: {
    flex: 1,
  },
  outlineLabel: {
    fontSize: 14,
    color: '#111827',
  },
  outlineMove: {
    width: 28,
    alignItems: 'center',
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
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  // `bottom` is set inline (104 + the device's real safe-area inset) -
  // see the component body. Board is a screen inside the "Дошки" tab, so
  // FloatingIslandTabBar's pill (bottom: 24, ~48 tall) is always showing
  // underneath here - 104 is the fixed clearance BulkActionBar's own
  // aboveTabBar variant uses for the same pill.
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8B5CF6',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 6,
  },
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
  // left/top pinned at 0 on purpose - the column's world position rides
  // entirely on its animated transform, same as a card's.
  column: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: COLUMN_WIDTH,
    borderRadius: 14,
    backgroundColor: 'rgba(17,24,39,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.12)',
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
    color: '#374151',
  },
  columnCount: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  toolButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  toolButtonActive: {
    backgroundColor: SELECTION_COLOR,
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
  selectionBarCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
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
  selectionBarCount: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  selectionBarDivider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  selectionBarAction: {
    alignItems: 'center',
    gap: 3,
  },
  selectionBarActionLabel: {
    fontSize: 9.5,
    fontWeight: '600',
    color: '#fff',
  },
  // Same dark-glass treatment as the selection bar's own capsule above,
  // for the one confirmation that sits over the canvas itself rather than
  // this app's usual native Alert.
  glassConfirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  glassConfirmCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: 'rgba(30,30,34,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 20,
    padding: 20,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 8,
  },
  glassConfirmTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  glassConfirmBody: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 19,
  },
  glassConfirmButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  glassConfirmButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  glassConfirmButtonDanger: {
    backgroundColor: '#EF4444',
  },
  glassConfirmButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
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
    fontSize: 15,
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
  textEditInput: {
    minHeight: 100,
    fontSize: 15,
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
    color: '#6B7280',
  },
  textEditSave: {
    backgroundColor: '#8B5CF6',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  textEditSaveLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
