import { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import AttachmentImage from './AttachmentImage';
import { Block } from '../types';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import {
  GLASS_BODY_BLURRED,
  GLASS_EDGE,
  GLASS_LINE,
  GLASS_TEXT,
  GLASS_TEXT_FAINT,
  GLASS_TEXT_MUTED,
} from '../constants/glass';

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

export type CanvasPlacement = { id: string; x: number; y: number };

// Where every block sits: its own position once it has been moved, and
// otherwise a place in a plain column, in the document's own order. The
// fallback is computed, never written - a document nobody has arranged
// looks arranged anyway, and still carries nothing extra.
export function layOutBlocks(blocks: Block[]): CanvasPlacement[] {
  let nextY = 0;
  return blocks.map((block) => {
    if (block.canvas) return { id: block.id, x: block.canvas.x, y: block.canvas.y };
    const y = nextY;
    nextY += approximateHeight(block) + LANE_GAP;
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
  onOpenBlock,
}: {
  blocks: Block[];
  // Called once, when a card is let go - not on every frame of the drag.
  onMoveBlock: (id: string, x: number, y: number) => void;
  onOpenBlock: (id: string) => void;
}) {
  const { width } = useWindowDimensions();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(width > CARD_WIDTH * 2 ? 40 : 16);
  const translateY = useSharedValue(120);
  const savedTranslateX = useSharedValue(translateX.value);
  const savedTranslateY = useSharedValue(translateY.value);

  const placements = useMemo(() => layOutBlocks(blocks), [blocks]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const panGesture = Gesture.Pan()
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

  const canvasGesture = Gesture.Simultaneous(pinchGesture, panGesture);

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
            {blocks.map((block, index) => (
              <CanvasCard
                key={block.id}
                block={block}
                placement={placements[index]}
                canvasScale={scale}
                canvasPanGesture={panGesture}
                onMove={onMoveBlock}
                onOpen={onOpenBlock}
              />
            ))}
          </Animated.View>
        </Animated.View>
      </GestureDetector>
      {blocks.length === 0 && (
        <View style={styles.emptyState} pointerEvents="none">
          <Ionicons name="shapes-outline" size={30} color={GLASS_TEXT_FAINT} />
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
  onMove,
  onOpen,
}: {
  block: Block;
  placement: CanvasPlacement;
  canvasScale: ReturnType<typeof useSharedValue<number>>;
  canvasPanGesture: ReturnType<typeof Gesture.Pan>;
  onMove: (id: string, x: number, y: number) => void;
  onOpen: (id: string) => void;
}) {
  const posX = useSharedValue(placement.x);
  const posY = useSharedValue(placement.y);

  const dragGesture = Gesture.Pan()
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

  const tapGesture = Gesture.Tap().onEnd(() => {
    runOnJS(onOpen)(block.id);
  });

  const gesture = Gesture.Race(dragGesture, tapGesture);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: posX.value }, { translateY: posY.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.card, cardStyle]}>
        <CardBody block={block} />
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
          color={GLASS_TEXT_MUTED}
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
          color={block.checked ? GLASS_TEXT_MUTED : GLASS_TEXT_FAINT}
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
      <Ionicons name={icon} size={18} color={GLASS_TEXT_MUTED} />
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
  card: {
    position: 'absolute',
    width: CARD_WIDTH,
    minHeight: 56,
    backgroundColor: GLASS_BODY_BLURRED,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
    borderRadius: 16,
    padding: 12,
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: 140,
    borderRadius: 10,
    backgroundColor: GLASS_LINE,
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
    color: GLASS_TEXT,
  },
  cardTextDone: {
    color: GLASS_TEXT_MUTED,
    textDecorationLine: 'line-through',
  },
  cardHeading: {
    fontSize: 17,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT,
  },
  cardDivider: {
    height: 1,
    backgroundColor: GLASS_LINE,
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
    color: GLASS_TEXT_FAINT,
  },
});
