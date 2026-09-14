import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
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
  // Text: the card clamps to six lines, so this is the most it can be.
  return Math.min(180, 56 + Math.floor((block.text?.length ?? 0) / 28) * 20);
}

export default function DocumentCanvas({
  blocks,
  onMoveBlock,
  onChangeText,
  onOpenBlock,
}: {
  blocks: Block[];
  // Called once, when a card is let go - not on every frame of the drag.
  onMoveBlock: (id: string, x: number, y: number) => void;
  // The editor's own handler, untouched: one place decides what typing
  // into a block means (list continuation, undo snapshots, mirrors), and
  // the canvas is just another keyboard pointed at it.
  onChangeText: (id: string, text: string) => void;
  onOpenBlock: (id: string) => void;
}) {
  const { width } = useWindowDimensions();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(width > CARD_WIDTH * 2 ? 40 : 16);
  const translateY = useSharedValue(120);
  const savedTranslateX = useSharedValue(translateX.value);
  const savedTranslateY = useSharedValue(translateY.value);

  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  const placements = useMemo(() => layOutBlocks(blocks, cardHeights), [blocks, cardHeights]);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Rounded to the point: a height that wobbles by a fraction between
  // frames would re-lay the whole column out for nothing.
  function reportHeight(id: string, height: number) {
    const rounded = Math.round(height);
    setCardHeights((prev) => (prev[id] === rounded ? prev : { ...prev, [id]: rounded }));
  }

  function stopEditing() {
    setEditingId(null);
    Keyboard.dismiss();
  }

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
    // Not while something is being typed into. In a browser, dragging
    // across text is how a word gets selected, and a surface that also
    // takes that drag slides the whole canvas out from under the cursor
    // instead. The card is already parked in a known place while it is
    // being typed into, so there is nothing to pan to.
    .enabled(editingId === null)
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

  const surfaceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={styles.viewport}>
      <GestureDetector gesture={canvasGesture}>
        <Animated.View style={styles.fill}>
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
                onHeight={reportHeight}
                onMove={onMoveBlock}
                onChangeText={onChangeText}
                onEdit={(id, x, y) => {
                  setEditingId(id);
                  revealForEditing(x, y);
                }}
                onOpen={onOpenBlock}
              />
            ))}
          </Animated.View>
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
  onHeight: (id: string, height: number) => void;
  onMove: (id: string, x: number, y: number) => void;
  onChangeText: (id: string, text: string) => void;
  onEdit: (id: string, x: number, y: number) => void;
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
  useEffect(() => {
    autoGrowInput(inputRef.current);
  }, [block.text, editing]);

  function handleTap(x: number, y: number) {
    // A picture or a file has controls of its own, and they are on the
    // page - so that is where a tap on one goes. Text is typed where it
    // stands.
    if (isText) onEdit(block.id, x, y);
    else onOpen(block.id);
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
    .onEnd(() => {
      runOnJS(handleTap)(posX.value, posY.value);
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
          <TextInput
            ref={(node) => {
              inputRef.current = node;
              // On mount too: the field is created already holding the
              // whole block's text.
              autoGrowInput(node);
            }}
            autoFocus
            multiline
            value={block.text}
            onChangeText={(text) => onChangeText(block.id, text)}
            placeholder="Текст"
            placeholderTextColor={PAPER_TEXT_FAINT}
            style={styles.cardInput}
          />
        ) : (
          <CardBody block={block} />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

// What a block looks like on the canvas: enough to recognise it, never
// enough to edit it. Editing is the page's job, and a tap is the way
// there.
function CardBody({ block }: { block: Block }) {
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
        <Text style={styles.cardText} numberOfLines={5}>
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
        <Text style={[styles.cardText, block.checked && styles.cardTextDone]} numberOfLines={4}>
          {block.text || 'Пункт'}
        </Text>
      </View>
    );
  }
  return (
    <Text style={styles.cardText} numberOfLines={6}>
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
