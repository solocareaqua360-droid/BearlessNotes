import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, SharedValue, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { doc, getDoc, getDocFromCache, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { BoardsStackParamList, RootStackParamList } from '../navigation';
import { Block, BoardCard, BoardColumn, BoardConnection } from '../types';
import AddExistingItemModal from '../components/AddExistingItemModal';
import RenamePrompt from '../components/RenamePrompt';
import VideoPlayerModal from '../components/VideoPlayerModal';
import { getVideoEmbedInfo } from '../utils/videoEmbed';

const AUTOSAVE_DELAY_MS = 600;
const DEFAULT_CARD_WIDTH = 160;
const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
// A large fixed virtual canvas rather than an unbounded one - card x/y are
// plain offsets from this world's own top-left, and the world container
// itself starts centered on screen (see canvasSurface/world styles), so
// WORLD_CENTER is where a freshly created card lands by default.
const WORLD_SIZE = 6000;
const WORLD_CENTER = WORLD_SIZE / 2;
const STICKY_COLORS = ['#FEF3C7', '#DBEAFE', '#DCFCE7', '#FCE7F3', '#EDE9FE', '#FFE4E6'];
// Cards don't carry their own rendered height (only width) - close enough
// for hit-testing the marquee-selection rectangle against, not meant to be
// pixel-exact.
const APPROX_CARD_HEIGHT = 140;
const SELECTION_COLOR = '#2563EB';
// Kanban columns. A column is exactly wide enough for a default card plus
// its own padding on both sides, so a card dropped in sits flush.
const COLUMN_PADDING = 12;
const COLUMN_WIDTH = DEFAULT_CARD_WIDTH + COLUMN_PADDING * 2;
const COLUMN_HEADER_HEIGHT = 44;
const COLUMN_CARD_GAP = 12;
// A column with nothing in it still has to be a visible drop target.
const COLUMN_MIN_HEIGHT = 220;
const COLUMN_SPACING = 24;
// How far outside a column's own bounds a dropped card still gets pulled
// into it. Generous on purpose - dropping a card "at" a column shouldn't
// require landing inside its box.
const COLUMN_SNAP_MARGIN = 90;
const CONNECTION_COLOR = '#8B5CF6';
// Padding around a connection's own bounding box, so the curve's bulge and
// the stroke width itself aren't clipped by the little Svg canvas each
// connection is drawn into.
const CONNECTION_PADDING = 24;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
function connectionEndpoints(from: BoardCard, to: BoardCard) {
  const fromCenterX = from.x + from.width / 2;
  const toCenterX = to.x + to.width / 2;
  const fromIsLeft = fromCenterX <= toCenterX;
  return {
    x1: fromIsLeft ? from.x + from.width : from.x,
    y1: from.y + APPROX_CARD_HEIGHT / 2,
    x2: fromIsLeft ? to.x : to.x + to.width,
    y2: to.y + APPROX_CARD_HEIGHT / 2,
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

type DraggableCardProps = {
  card: BoardCard;
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
  canvasScale,
  canvasPanGesture,
  isDragging,
  isSelected,
  isGroupDrag,
  groupOffsetX,
  groupOffsetY,
  dragEnabled,
  onMeasure,
  onDragStart,
  onDragEnd,
  onGroupDragEnd,
  onTap,
  onLongPress,
}: DraggableCardProps) {
  const posX = useSharedValue(card.x);
  const posY = useSharedValue(card.y);
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

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: posX.value + (isSelected ? groupOffsetX.value : 0) },
      { translateY: posY.value + (isSelected ? groupOffsetY.value : 0) },
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
  const { boardId } = params;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

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
      const wx = (e.x - windowWidth / 2 - translateX.value) / scale.value + WORLD_CENTER;
      const wy = (e.y - windowHeight / 2 - translateY.value) / scale.value + WORLD_CENTER;
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
      const wx = (e.x - windowWidth / 2 - translateX.value) / scale.value + WORLD_CENTER;
      const wy = (e.y - windowHeight / 2 - translateY.value) / scale.value + WORLD_CENTER;
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
    const blocks: Block[] = snapshot.data()?.blocks ?? [];
    const preview = {
      text: blocksToPreviewText(blocks).slice(0, 20000),
      imageUri: firstImageUri(blocks),
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

  function editDocumentCard(card: BoardCard) {
    if (!card.documentId) return;
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

  function renameColumn(column: BoardColumn, title: string) {
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, title: title.trim() || c.title } : c)));
    setRenamingColumn(null);
  }

  function confirmDeleteColumn(column: BoardColumn) {
    Alert.alert('Видалити стовпчик?', 'Картки з нього залишаться на дошці.', [
      { text: 'Скасувати', style: 'cancel' },
      {
        text: 'Видалити',
        style: 'destructive',
        onPress: () => {
          // Cards keep the position the column had them in - the reflow
          // effect below strips the now-dangling columnId when `columns`
          // changes.
          setColumns((prev) => prev.filter((c) => c.id !== column.id));
        },
      },
    ]);
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
  const movingCardIds = !draggedCardId
    ? null
    : selectedCardIds.has(draggedCardId) && selectedCardIds.size > 1
      ? selectedCardIds
      : new Set([draggedCardId]);
  const selectionHasConnections = connections.some(
    (c) => selectedCardIds.has(c.fromCardId) || selectedCardIds.has(c.toCardId)
  );

  return (
    <View style={styles.container}>
      <GestureDetector gesture={canvasGesture}>
        <View style={[StyleSheet.absoluteFill, styles.canvasSurface]}>
          <Animated.View style={[styles.world, worldAnimatedStyle]}>
            {/* Underneath everything - a column is a backdrop its cards sit
                on. box-none so only the header takes touches and the rest
                of the lane still pans the canvas. */}
            {columns.map((column) => {
              const members = columnMembers(cards, column.id);
              return (
                <View
                  key={column.id}
                  style={[
                    styles.column,
                    { left: column.x, top: column.y, height: columnHeight(members, cardHeights) },
                  ]}
                  pointerEvents="box-none"
                >
                  <Pressable
                    style={styles.columnHeader}
                    onPress={() => setRenamingColumn(column)}
                    onLongPress={() => confirmDeleteColumn(column)}
                  >
                    <View style={styles.columnTitleWrap}>
                      <Text style={styles.columnTitle} numberOfLines={1}>
                        {column.title}
                      </Text>
                    </View>
                    <Text style={styles.columnCount}>{members.length}</Text>
                  </Pressable>
                </View>
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
              if (movingCardIds && (movingCardIds.has(from.id) || movingCardIds.has(to.id))) return null;
              const { x1, y1, x2, y2 } = connectionEndpoints(from, to);
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
              return (
                <DraggableCard
                  key={card.id}
                  card={card}
                  canvasScale={scale}
                  canvasPanGesture={canvasBlockingGesture}
                  isDragging={card.id === draggedCardId}
                  isSelected={isSelected}
                  isGroupDrag={isSelected && selectedCardIds.size > 1}
                  groupOffsetX={groupOffsetX}
                  groupOffsetY={groupOffsetY}
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

      <View style={styles.headerRow} pointerEvents="box-none">
        <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </Pressable>
        <Pressable style={styles.titleTap} onPress={() => setRenamingTitle(true)}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title || 'Без назви'}
          </Text>
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
        <View style={styles.selectionBar}>
          <Text style={styles.selectionBarLabel}>Обрано: {selectedCardIds.size}</Text>
          <View style={styles.selectionBarActions}>
            {onlySelectedDocumentCard && (
              <Pressable
                style={styles.selectionBarButton}
                onPress={() => editDocumentCard(onlySelectedDocumentCard)}
              >
                <Ionicons name="create-outline" size={16} color="#fff" />
                <Text style={styles.selectionBarButtonLabel}>Редагувати</Text>
              </Pressable>
            )}
            {selectionHasConnections && (
              <Pressable style={styles.selectionBarButton} onPress={disconnectSelectedCards}>
                <MaterialCommunityIcons name="vector-line" size={16} color="#fff" />
                <Text style={styles.selectionBarButtonLabel}>Відʼєднати</Text>
              </Pressable>
            )}
            <Pressable style={styles.selectionBarButton} onPress={() => setSelectedCardIds(new Set())}>
              <Ionicons name="close" size={16} color="#fff" />
              <Text style={styles.selectionBarButtonLabel}>Скасувати</Text>
            </Pressable>
            <Pressable
              style={[styles.selectionBarButton, styles.selectionBarButtonDanger]}
              onPress={deleteSelectedCards}
            >
              <Ionicons name="trash-outline" size={16} color="#fff" />
              <Text style={styles.selectionBarButtonLabel}>Видалити</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable style={styles.fab} onPress={() => setAddSheetVisible(true)}>
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

      <RenamePrompt
        visible={renamingColumn !== null}
        title="Назва стовпчика"
        initialValue={renamingColumn?.title ?? ''}
        onCancel={() => setRenamingColumn(null)}
        onSave={(value) => {
          if (renamingColumn) renameColumn(renamingColumn, value);
        }}
      />

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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
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
  fab: {
    position: 'absolute',
    right: 20,
    // Board is a screen inside the "Дошки" tab, so FloatingIslandTabBar's
    // pill (bottom: 24, ~48 tall) is always showing underneath here - same
    // clearance BulkActionBar's own aboveTabBar variant uses to clear it.
    bottom: 104,
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
  column: {
    position: 'absolute',
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
  // Same dark frosted-glass capsule as the shared BulkActionBar component
  // (Documents/Files/Photos/Links' own multi-select bar) - kept local
  // rather than reusing that component directly since its action set
  // (tag/group/copy) doesn't apply to board cards.
  selectionBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    // Same clearance as the FAB above - the floating tab bar sits
    // underneath this screen too.
    bottom: 104,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(20,20,20,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 8,
  },
  selectionBarLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  selectionBarActions: {
    flexDirection: 'row',
    gap: 8,
  },
  selectionBarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  selectionBarButtonDanger: {
    backgroundColor: '#EF4444',
  },
  selectionBarButtonLabel: {
    fontSize: 13,
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
