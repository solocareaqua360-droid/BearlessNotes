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
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { doc, getDoc, getDocFromCache, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { BoardsStackParamList, RootStackParamList } from '../navigation';
import { Block, BoardCard } from '../types';
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
  const [canvasTool, setCanvasTool] = useState<'move' | 'select'>('move');
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());

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

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setIsLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  useEffect(() => {
    if (!isLoaded) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setDoc(doc(db, 'boards', boardId), { title, cards, updatedAt: Date.now() }, { merge: true });
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, cards, isLoaded]);

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
  const canvasBlockingGesture = canvasTool === 'select' ? selectGesture : panGesture;
  const canvasGesture = canvasTool === 'select' ? selectGesture : Gesture.Simultaneous(pinchGesture, panGesture);

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

  function commitCardDrag(id: string, x: number, y: number) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, x, y } : c)));
    setDraggedCardId(null);
  }

  // Dragging any one selected card moves the whole selection - see
  // DraggableCard's isGroupDrag branch, which accumulates the shared delta
  // instead of moving just itself.
  function commitGroupDrag(dx: number, dy: number) {
    setCards((prev) => prev.map((c) => (selectedCardIds.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c)));
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
          setCards((prev) => prev.filter((c) => !selectedCardIds.has(c.id)));
          setSelectedCardIds(new Set());
        },
      },
    ]);
  }

  function toggleCanvasTool() {
    setCanvasTool((prev) => (prev === 'move' ? 'select' : 'move'));
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

  return (
    <View style={styles.container}>
      <GestureDetector gesture={canvasGesture}>
        <View style={[StyleSheet.absoluteFill, styles.canvasSurface]}>
          <Animated.View style={[styles.world, worldAnimatedStyle]}>
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
                  onDragStart={handleDragStart}
                  onDragEnd={commitCardDrag}
                  onGroupDragEnd={commitGroupDrag}
                  onTap={handleCardTap}
                  onLongPress={handleCardLongPress}
                />
              );
            })}
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
        <Pressable
          style={[styles.toolButton, canvasTool === 'select' && styles.toolButtonActive]}
          onPress={toggleCanvasTool}
        >
          <MaterialCommunityIcons
            name="cursor-move"
            size={20}
            color={canvasTool === 'select' ? '#fff' : '#111827'}
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
