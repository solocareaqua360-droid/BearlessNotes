import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import AttachmentImage from './AttachmentImage';
import { autoGrowInput } from '../utils/autoGrowInput';
import { caretIndexFromDom } from '../utils/caretAtPoint';
import { CaretLine, displayIndexForTouch } from '../utils/caretFromTextLayout';
import { canPlaceCaretByTouch, measureNode } from '../utils/measureNode';
import { useCanvasWheel } from '../hooks/useCanvasWheel';
import { setSelection } from '../utils/setSelection';
import { Block } from '../types';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// The canvas is part of the note, and the note is paper - white, with
// dark text. The glass palette belongs to the windows that float OVER a
// screen; a card lying ON the page is not one of those, and translucent
// dark cards on white paper read as smudges. So these are the page's own
// colours, the same ones the blocks have when they are read down the
// page instead of across it.
const PAPER_CARD = '#FFFFFF';
const PAPER_EDGE = '#E5E7EB';
const PAPER_EDGE_EDITING = '#8AB4FF';
const PAPER_TEXT = '#111827';
const PAPER_TEXT_MUTED = '#6B7280';
const PAPER_TEXT_FAINT = '#9CA3AF';

// «Полотно» - the same document, laid out freely instead of down a page.
//
// The idea is AFFiNE's: a note is a sequence when you are writing it and a
// surface when you are thinking about it, and the two should be the same
// document rather than two places to keep things in step. So this draws the
// blocks the editor already has, at positions kept on the blocks
// themselves, and writing stays in the page - a tap on a card goes back
// there with that block open.
//
// Deliberately NOT built on BoardScreen's canvas yet. That one carries
// columns, connections, a marquee, group drags and a minimap, all tied to
// board cards; the shared piece worth extracting is the pan/zoom surface
// underneath, and this is the second user that will say what its shape
// has to be. Same numbers as the board on purpose (0.4-3x, 12pt before a
// pan counts), so the two feel like one gesture language.
const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
const CARD_WIDTH = 240;
const LANE_GAP = 20;
// Where a card being typed into is put: near the top, clear of the
// keyboard whatever its height, and clear of the rail on the right.
const EDIT_TOP = 88;
const EDIT_LEFT = 16;

// The blocks whose content IS their text, and which can therefore be
// typed into on the canvas. Everything else (a picture, a file, an
// embedded database) is opened on the page, where its own controls are.
const TEXT_TYPES = ['paragraph', 'bulleted', 'numbered', 'checkbox'];

// Typing in a card works on both. What differs is what has to be done
// about the TAP, and only a browser needs any of it: there a gesture
// over the whole surface also sees the clicks meant for the text, and a
// drag across text is how a word gets selected. On a phone the field
// takes its own touches and neither problem exists - so neither fix is
// applied there, because both of them cost something (a canvas that does
// not pan, a view under the cards) and a phone gains nothing in return.
const NEEDS_TAP_GUARDS = Platform.OS === 'web';

export type CanvasPlacement = { id: string; x: number; y: number };

// Where every block sits: its own position once it has been moved, and
// otherwise a place in a plain column, in the document's own order. The
// fallback is computed, never written - a document nobody has arranged
// looks arranged anyway, and still carries nothing extra.
//
// `heights` are the cards' MEASURED heights, reported by each card as it
// lays itself out. Guessing them from the text length put every card in
// the column a little too close to the one above, and the long ones
// overlapped outright - a card's real height depends on the font, the
// width and where the words happen to break, which only layout knows.
// The guess stays as the value for a card that has not reported yet, for
// the single frame before it does.
export function layOutBlocks(
  blocks: Block[],
  heights: Record<string, number> = {}
): CanvasPlacement[] {
  let nextY = 0;
  return blocks.map((block) => {
    if (block.canvas) return { id: block.id, x: block.canvas.x, y: block.canvas.y };
    const y = nextY;
    nextY += (heights[block.id] ?? approximateHeight(block)) + LANE_GAP;
    return { id: block.id, x: 0, y };
  });
}

function approximateHeight(block: Block): number {
  const type = block.type ?? 'paragraph';
  if (type === 'image' || type === 'sketch') return 180;
  if (type === 'file' || type === 'link' || type === 'dbRow' || type === 'dbView') return 96;
  // Text: a card shows ALL of it, so this only has to be close - it is
  // replaced by the measured height on the next frame. Roughly 28
  // characters to a line at this width, 19pt a line, plus the padding.
  return 32 + Math.max(1, Math.ceil((block.text?.length ?? 0) / 28)) * 19;
}

// What the screen around the canvas can ask of it. One method, and it
// exists because the way OUT of typing has to be reachable from the rail
// as well: the back arrow there used to leave the whole document while
// the caret was still blinking in a card.
export type DocumentCanvasHandle = { stopEditing: () => void };

function DocumentCanvasInner({
  blocks,
  onMoveBlock,
  onChangeText,
  onOpenBlock,
  onEditingChange,
}: {
  blocks: Block[];
  // Called once, when a card is let go - not on every frame of the drag.
  onMoveBlock: (id: string, x: number, y: number) => void;
  // The editor's own handler, untouched: one place decides what typing
  // into a block means (list continuation, undo snapshots, mirrors), and
  // the canvas is just another keyboard pointed at it.
  onChangeText: (id: string, text: string) => void;
  onOpenBlock: (id: string) => void;
  // So the screen can offer its own way out while a card is being typed
  // into - see DocumentCanvasHandle.
  onEditingChange?: (editing: boolean) => void;
}, ref: React.Ref<DocumentCanvasHandle>) {
  const { width } = useWindowDimensions();
  // The trackpad, on a laptop: two fingers move the canvas, a pinch zooms
  // it around the pointer, shift+scroll goes sideways. The board's own
  // hook, unchanged - a hand that has learnt the board already knows this
  // canvas, and without it a trackpad pinch zooms the whole PAGE instead.
  // A no-op on the phone, where two fingers already say it.
  const canvasRef = useRef<View | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(width > CARD_WIDTH * 2 ? 40 : 16);
  const translateY = useSharedValue(120);
  const savedTranslateX = useSharedValue(translateX.value);
  const savedTranslateY = useSharedValue(translateY.value);

  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  const placements = useMemo(() => layOutBlocks(blocks, cardHeights), [blocks, cardHeights]);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Which character the click that started the editing landed on. The
  // field does not exist yet at that moment - the card is showing plain
  // text - so the answer is taken from the text that IS there and handed
  // to the field when it mounts.
  const [editingCaret, setEditingCaret] = useState<number | null>(null);

  // Rounded to the point: a height that wobbles by a fraction between
  // frames would re-lay the whole column out for nothing.
  function reportHeight(id: string, height: number) {
    const rounded = Math.round(height);
    setCardHeights((prev) => (prev[id] === rounded ? prev : { ...prev, [id]: rounded }));
  }

  function stopEditing() {
    setEditingId(null);
    setEditingCaret(null);
    Keyboard.dismiss();
  }

  useImperativeHandle(ref, () => ({ stopEditing }));

  useEffect(() => {
    onEditingChange?.(editingId !== null);
  }, [editingId, onEditingChange]);

  // Back ends the typing before it ends anything else. Without this the
  // system's own back gesture walked out of the document with the caret
  // still in a card, which is not what "back" meant at that moment.
  useEffect(() => {
    if (editingId === null) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      stopEditing();
      return true;
    });
    return () => sub.remove();
  }, [editingId]);

  // A card about to be typed into is brought to a known place rather than
  // left wherever the canvas happened to be - the keyboard takes the lower
  // half of the screen, and a card that was already down there would be
  // typed into blind. Deterministic on purpose: the same corner every
  // time, so the eye knows where to go back to.
  function revealForEditing(x: number, y: number) {
    const target = scale.value;
    translateX.value = withTiming(EDIT_LEFT - x * target, { duration: 180 });
    translateY.value = withTiming(EDIT_TOP - y * target, { duration: 180 });
    savedTranslateX.value = EDIT_LEFT - x * target;
    savedTranslateY.value = EDIT_TOP - y * target;
  }

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const panGesture = Gesture.Pan()
    // In a browser, not while something is being typed into: dragging
    // across text is how a word gets selected there, and a surface that
    // also takes that drag slides the whole canvas out from under the
    // cursor instead. The card is parked in a known place while it is
    // edited anyway. A phone keeps its pan - a finger dragging the canvas
    // never begins inside the field.
    .enabled(editingId === null || !NEEDS_TAP_GUARDS)
    // The board's own number: a hold and a drag start the same way, and a
    // surface that takes the very first pixel moves before the press can
    // count as anything else.
    .minDistance(12)
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const canvasGesture = Gesture.Simultaneous(panGesture, pinchGesture);

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

  const surfaceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View
      style={styles.viewport}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setViewport((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }}
    >
      <GestureDetector gesture={canvasGesture}>
        <Animated.View style={styles.fill}>
          {/* The wheel listener goes on a plain View INSIDE the gesture
              detector, which is where the board has it. Outside it, the
              events the trackpad sends never reached this - so the canvas
              could only be moved by pressing and dragging it, and that
              drag is wanted for choosing cards, not for moving the view. */}
          <View ref={canvasRef} style={StyleSheet.absoluteFill} collapsable={false}>
          <Animated.View style={[styles.surface, surfaceStyle]}>
            {/* A tap on bare canvas puts the text down, the way clicking
                beside a thing ends editing everywhere else. It is a view
                BEHIND the cards rather than a gesture on the whole
                surface: a gesture up there sees every tap, including the
                ones meant for the text - so in a browser each attempt to
                move the caret ended the editing instead, and the caret
                never left the start. Behind the cards, a tap on a card
                simply never reaches it. */}
            {editingId !== null && (
              // A tap beside the cards puts the text down. In a browser
              // this has to be a view BEHIND the cards rather than a
              // gesture over the surface, because a gesture up there also
              // sees the clicks meant for the text; on a phone the field
              // keeps its own touches, so either works and this is the
              // one that already exists.
              <Pressable style={styles.stopEditingCatcher} onPress={stopEditing} />
            )}
            {blocks.map((block, index) => (
              <CanvasCard
                key={block.id}
                block={block}
                placement={placements[index]}
                canvasScale={scale}
                canvasPanGesture={panGesture}
                editing={editingId === block.id}
                caretIndex={editingId === block.id ? editingCaret : null}
                onDone={stopEditing}
                onHeight={reportHeight}
                onMove={onMoveBlock}
                onChangeText={onChangeText}
                onEdit={(id, x, y, caretIndex) => {
                  setEditingId(id);
                  setEditingCaret(caretIndex);
                  revealForEditing(x, y);
                }}
                onOpen={onOpenBlock}
              />
            ))}
          </Animated.View>
          </View>
        </Animated.View>
      </GestureDetector>
      {blocks.length === 0 && (
        <View style={styles.emptyState} pointerEvents="none">
          <Ionicons name="shapes-outline" size={30} color={PAPER_TEXT_FAINT} />
          <Text style={styles.emptyLabel}>Порожня нотатка - напишіть щось на сторінці</Text>
        </View>
      )}
    </View>
  );
}

function CanvasCard({
  block,
  placement,
  canvasScale,
  canvasPanGesture,
  editing,
  caretIndex,
  onDone,
  onHeight,
  onMove,
  onChangeText,
  onEdit,
  onOpen,
}: {
  block: Block;
  placement: CanvasPlacement;
  canvasScale: ReturnType<typeof useSharedValue<number>>;
  canvasPanGesture: ReturnType<typeof Gesture.Pan>;
  editing: boolean;
  caretIndex: number | null;
  onHeight: (id: string, height: number) => void;
  onMove: (id: string, x: number, y: number) => void;
  onChangeText: (id: string, text: string) => void;
  onEdit: (id: string, x: number, y: number, caretIndex: number | null) => void;
  onDone: () => void;
  onOpen: (id: string) => void;
}) {
  const posX = useSharedValue(placement.x);
  const posY = useSharedValue(placement.y);
  const isText = TEXT_TYPES.includes(block.type ?? 'paragraph');
  // A browser's multi-line field does not grow with its text: it is a
  // <textarea>, two rows tall, with the rest scrolled out of sight inside
  // it - so a card being typed into shrank to a slot while the text it
  // was showing a moment ago was still there, hidden. Same helper the
  // page's own blocks use; on a phone it does nothing.
  const inputRef = useRef<TextInput | null>(null);
  // The card's own text as the browser drew it - what gets asked which
  // character a click hit.
  const textNodeRef = useRef<Text>(null);
  // Where each line of that text was laid out. A phone has no way to ask
  // which character a touch hit, so the answer is reconstructed from
  // these - see caretFromTextLayout, the same maths the page's blocks
  // have always used.
  const linesRef = useRef<CaretLine[]>([]);
  useEffect(() => {
    autoGrowInput(inputRef.current);
  }, [block.text, editing]);

  async function handleTap(x: number, y: number, pageX: number, pageY: number) {
    // A picture or a file has controls of its own, and they are on the
    // page - so that is where a tap on one goes. Text is typed where it
    // stands.
    if (!isText) {
      onOpen(block.id);
      return;
    }
    // ONE click, straight to the character it hit. A browser can be asked
    // this outright; without asking, the field opened with the caret at
    // the start and it took a second click to put it where the first one
    // had already pointed. Null on a phone - there is no document to ask
    // - and the field then does what it always did.
    const fromDom = caretIndexFromDom(textNodeRef.current, pageX, pageY);
    if (fromDom !== null) {
      onEdit(block.id, x, y, fromDom);
      return;
    }
    // The phone: the same reconstruction the page's blocks use - the line
    // the touch fell on, then the character along it. Without it the
    // field opened with the caret at the end of the text, wherever the
    // finger had actually been.
    const box = canPlaceCaretByTouch ? await measureNode(textNodeRef.current) : null;
    if (!box) {
      onEdit(block.id, x, y, null);
      return;
    }
    onEdit(
      block.id,
      x,
      y,
      displayIndexForTouch(linesRef.current, block.text ?? '', pageX - box.x, pageY - box.y)
    );
  }

  const dragGesture = Gesture.Pan()
    // While the card is being typed into it must not move under the
    // finger: the touches belong to the text - placing a caret, choosing
    // a word. Tap the canvas to put the text down, then drag.
    .enabled(!editing)
    // Without this the surface underneath also recognises a sliver of the
    // same touch, which lands as a jump when the finger lifts. The board
    // hit exactly this.
    .blocksExternalGesture(canvasPanGesture)
    // Per-event delta divided by the zoom, so a card keeps up with the
    // finger 1:1 however far in or out the canvas is.
    .onChange((e) => {
      posX.value += e.changeX / canvasScale.value;
      posY.value += e.changeY / canvasScale.value;
    })
    .onEnd(() => {
      runOnJS(onMove)(block.id, posX.value, posY.value);
    });

  const tapGesture = Gesture.Tap()
    .enabled(!editing)
    .onEnd((e) => {
      runOnJS(handleTap)(posX.value, posY.value, e.absoluteX, e.absoluteY);
    });

  const gesture = Gesture.Race(dragGesture, tapGesture);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: posX.value }, { translateY: posY.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.card, editing && styles.cardEditing, cardStyle]}
        onLayout={(e) => onHeight(block.id, e.nativeEvent.layout.height)}
      >
        {editing ? (
          <>
          {/* The way out, on the card itself. Tapping beside the cards
              works too, but on a phone the keyboard covers most of what
              is beside them - so the one control that is certainly not
              under the keyboard is the card's own corner. An icon: there
              is no room for a word here, and a tick is what "done"
              looks like everywhere. */}
          <Pressable hitSlop={10} style={styles.cardDone} onPress={onDone}>
            <Ionicons name="checkmark" size={18} color={PAPER_TEXT_MUTED} />
          </Pressable>
          <TextInput
            ref={(node) => {
              inputRef.current = node;
              // On mount too: the field is created already holding the
              // whole block's text.
              autoGrowInput(node);
              if (node && caretIndex !== null) {
                // Twice: now, and again once the browser has given the
                // field focus - a selection set before the focus lands is
                // thrown away by the focus itself.
                setSelection(node, caretIndex, caretIndex);
                setTimeout(() => setSelection(node, caretIndex, caretIndex), 0);
              }
            }}
            autoFocus
            multiline
            value={block.text}
            onChangeText={(text) => onChangeText(block.id, text)}
            placeholder="Текст"
            placeholderTextColor={PAPER_TEXT_FAINT}
            style={styles.cardInput}
          />
          </>
        ) : (
          <CardBody
            block={block}
            textNode={textNodeRef}
            onTextLayout={(e) => {
              linesRef.current = e.nativeEvent.lines;
            }}
          />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

// What a block looks like on the canvas: enough to recognise it, never
// enough to edit it. Editing is the page's job, and a tap is the way
// there.
function CardBody({
  block,
  textNode,
  onTextLayout,
}: {
  block: Block;
  textNode?: React.Ref<Text>;
  onTextLayout?: (e: { nativeEvent: { lines: CaretLine[] } }) => void;
}) {
  const type = block.type ?? 'paragraph';

  if (type === 'image' || type === 'sketch') {
    return block.imageUri ? (
      <AttachmentImage
        uri={block.imageUri}
        driveFileId={block.driveFileId}
        style={styles.cardImage}
        resizeMode="cover"
      />
    ) : (
      <CardRow icon="image-outline" label="Зображення" />
    );
  }
  if (type === 'file') {
    return <CardRow icon="document-outline" label={block.fileTitle || block.fileName || 'Файл'} />;
  }
  if (type === 'link') {
    return <CardRow icon="link-outline" label={block.text || block.linkUrl || 'Посилання'} />;
  }
  if (type === 'dbRow' || type === 'dbView') {
    return <CardRow icon="albums-outline" label={block.text || 'База даних'} />;
  }
  if (type === 'divider') {
    return <View style={styles.cardDivider} />;
  }
  if (type === 'table') {
    return <CardRow icon="grid-outline" label={block.text || 'Таблиця'} />;
  }
  if (type === 'bulleted' || type === 'numbered') {
    return (
      <View style={styles.cardRow}>
        <Ionicons
          name={type === 'bulleted' ? 'ellipse' : 'list-outline'}
          size={type === 'bulleted' ? 7 : 16}
          color={PAPER_TEXT_MUTED}
        />
        <Text style={styles.cardText}>
          {block.text || ' '}
        </Text>
      </View>
    );
  }
  if (type === 'checkbox') {
    return (
      <View style={styles.cardRow}>
        <Ionicons
          name={block.checked ? 'checkbox' : 'square-outline'}
          size={18}
          color={block.checked ? PAPER_TEXT_MUTED : PAPER_TEXT_FAINT}
        />
        <Text style={[styles.cardText, block.checked && styles.cardTextDone]}>
          {block.text || 'Пункт'}
        </Text>
      </View>
    );
  }
  return (
    <Text ref={textNode} onTextLayout={onTextLayout} style={styles.cardText}>
      {block.text || ' '}
    </Text>
  );
}

function CardRow({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.cardRow}>
      <Ionicons name={icon} size={18} color={PAPER_TEXT_MUTED} />
      <Text style={styles.cardText} numberOfLines={3}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
  },
  // The surface itself has no size: the cards are absolutely positioned on
  // it and it is the transform that moves them all together.
  surface: {
    flex: 1,
  },
  // Big enough to catch a tap anywhere around the cards, in surface
  // coordinates - the canvas can be panned and zoomed far from its
  // origin, and this has to still be under wherever it ends up.
  stopEditingCatcher: {
    position: 'absolute',
    left: -4000,
    top: -4000,
    right: -4000,
    bottom: -4000,
  },
  // Opaque, and with a hairline edge: on white paper an edge is the only
  // thing that says where one card ends and the next begins.
  card: {
    position: 'absolute',
    width: CARD_WIDTH,
    minHeight: 56,
    // No cap on the height: a card used to stop at six lines and end in
    // an ellipsis, which on a surface meant for reading is the card
    // hiding what it is for. It grows to its text instead - the column
    // is laid out from measured heights anyway, so a tall card simply
    // takes the room it needs.
    backgroundColor: PAPER_CARD,
    borderWidth: 1,
    borderColor: PAPER_EDGE,
    borderRadius: 16,
    padding: 12,
    overflow: 'hidden',
    // A shadow rather than a fill difference - the card has to lift off
    // paper of the same colour as itself.
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  // The card being typed into: the app's own blue on its edge, so it is
  // plain which one the keyboard belongs to.
  cardEditing: {
    borderColor: PAPER_EDGE_EDITING,
    borderWidth: 2,
  },
  cardInput: {
    paddingRight: 22,
    // A browser gives a textarea its own default width (the `cols`
    // attribute), which is narrower than the card it sits in - the input
    // has to be told to fill its parent, exactly as the editor's own
    // inputs had to be.
    width: '100%',
    alignSelf: 'stretch',
    textAlignVertical: 'top',
    // No flex here on purpose. In the editor's rows `flex: 1` governs a
    // field's WIDTH (those rows lay out sideways); this card lays out
    // downwards, where flex would govern the HEIGHT instead and fight the
    // grown height above.
    fontSize: 14,
    lineHeight: 19,
    fontFamily: FONT_REGULAR,
    color: PAPER_TEXT,
    padding: 0,
    minHeight: 40,
  },
  // The corner tick. Padded into the card's own padding rather than
  // pushing the text aside - it only exists while that card is being
  // typed into.
  cardDone: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 2,
    padding: 4,
  },
  cardImage: {
    width: '100%',
    height: 140,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: FONT_REGULAR,
    color: PAPER_TEXT,
  },
  cardTextDone: {
    color: PAPER_TEXT_MUTED,
    textDecorationLine: 'line-through',
  },
  cardHeading: {
    fontSize: 17,
    fontFamily: FONT_SEMIBOLD,
    color: PAPER_TEXT,
  },
  cardDivider: {
    height: 1,
    backgroundColor: PAPER_EDGE,
    marginVertical: 8,
  },
  emptyState: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  emptyLabel: {
    fontSize: 14,
    textAlign: 'center',
    fontFamily: FONT_REGULAR,
    color: PAPER_TEXT_FAINT,
  },
});

// forwardRef, only so the screen can reach stopEditing - see
// DocumentCanvasHandle.
const DocumentCanvas = forwardRef(DocumentCanvasInner);
export default DocumentCanvas;
