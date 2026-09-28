import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Line } from 'react-native-svg';
import AttachmentImage from './AttachmentImage';
import ShapeBody from './BoardShapeBody';
import { BoardCard, BoardColumn, BoardConnection, BoardContainer, BoardShape } from '../types';
import { APPROX_CARD_HEIGHT, COLUMN_MIN_HEIGHT, COLUMN_WIDTH, fileIconFor } from '../utils/boardLayout';
import { withAlpha } from '../utils/color';
import { FONT_REGULAR } from '../utils/fonts';

// A board in miniature, built from its own cards rather than captured from
// the screen - this is the LIVE version, drawn fresh on every render of the
// boards list, so it has to stay cheap: real content only where reading it
// costs nothing (a card's own cached picture/colour), a pale block for
// everything else. The list of boards would rather this than a screenshot
// anyway - a real screenshot is only worth the capture cost once, when the
// board is actually left with real edits, which is `BoardMiniature`'s job
// (see `useBoardPreviewCapture`); this component is also what THAT renders
// into, with `detailed` on, since drawing every card as itself is the whole
// point of a capture.
//
// Real content where there is any: a photo card shows its photo, a sticky
// keeps its colour, everything else is a pale block. Small, that reads as
// the shape of the board; large, as the board.
export default function BoardMiniMap({
  cards,
  columns,
  connections,
  shapes,
  containers,
  width,
  height,
  showText,
  detailed,
}: {
  cards: BoardCard[];
  columns?: BoardColumn[];
  // Reserved for `detailed` (see below) - the arrows/lines between
  // cards, shapes AND containers: a BoardConnection's fromCardId/
  // toCardId "despite the name, either end can be any node kind" (see
  // BoardScreen's own nodeById) - a line to a shape read as missing
  // entirely until this looked shapes up too ("не промальовуються лінії
  // до фігури").
  connections?: BoardConnection[];
  // Reserved for `detailed` too - the board's own furniture (rectangle,
  // circle, triangle, diamond, loose text; there is no 'star' kind -
  // see BoardShapeKind in types.ts).
  shapes?: BoardShape[];
  // Not drawn (a container is a transparent frame, not worth a box of
  // its own at this size) - only here so a connection ending on one
  // still has somewhere real to point.
  containers?: BoardContainer[];
  width: number;
  height: number;
  // Text cards draw a couple of lines standing in for their words - only
  // worth it on a tile big enough for them to be lines rather than specks.
  showText?: boolean;
  // Reserved for the one-time capture (BoardMiniature): a sticky's own
  // text, a file's icon, a board-reference's title, the connection lines
  // and the shapes - readable in a screenshot that is drawn once, too
  // much extra drawing to redo on every list render of every board.
  detailed?: boolean;
}) {
  const lanes = (columns ?? []).map((column) => ({
    x: column.x,
    y: column.y,
    width: COLUMN_WIDTH,
    // An estimate: without measured card heights it only has to be close
    // enough to place the lane among its neighbours.
    height: Math.max(COLUMN_MIN_HEIGHT, 44 + cards.filter((c) => c.columnId === column.id).length * 100),
  }));
  const boxes = cards.map((card) => ({ x: card.x, y: card.y, width: card.width, height: APPROX_CARD_HEIGHT }));
  const shapeBoxes = (detailed ? shapes ?? [] : []).map((shape) => ({
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
  }));
  // Not drawn, but a connection can end on one, so it needs a box too -
  // both for the bounds below (an off-to-the-side container should not
  // get cropped just because nothing draws it) and for aiming a line.
  const containerBoxes = (detailed ? containers ?? [] : []).map((container) => ({
    x: container.x,
    y: container.y,
    width: container.width,
    height: container.height,
  }));
  const all = [...lanes, ...boxes, ...shapeBoxes, ...containerBoxes];
  if (all.length === 0) return <View style={{ width, height }} />;

  const minX = Math.min(...all.map((b) => b.x));
  const minY = Math.min(...all.map((b) => b.y));
  const maxX = Math.max(...all.map((b) => b.x + b.width));
  const maxY = Math.max(...all.map((b) => b.y + b.height));
  // One scale for both axes, so the board keeps its proportions instead of
  // being stretched into whatever box it's drawn in.
  const scale = Math.min((width - 8) / Math.max(maxX - minX, 1), (height - 8) / Math.max(maxY - minY, 1));
  const offsetX = 4 + (width - 8 - (maxX - minX) * scale) / 2;
  const offsetY = 4 + (height - 8 - (maxY - minY) * scale) / 2;
  const place = (b: { x: number; y: number; width: number; height: number }) => ({
    left: offsetX + (b.x - minX) * scale,
    top: offsetY + (b.y - minY) * scale,
    width: Math.max(2, b.width * scale),
    height: Math.max(2, b.height * scale),
  });

  // A connection's two ends are wherever ITS node ended up - found by id
  // rather than carrying their own coordinates, so a line always points
  // at the actual frame above, never a stale copy of it. A connection's
  // end can be a card, a shape or a container (see the props above), so
  // this covers all three, the same as BoardScreen's own nodeById.
  const centerById = new Map<string, { x: number; y: number }>();
  cards.forEach((card, index) => {
    const frame = place(boxes[index]);
    centerById.set(card.id, { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 });
  });
  if (detailed) {
    (shapes ?? []).forEach((shape, index) => {
      const frame = place(shapeBoxes[index]);
      centerById.set(shape.id, { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 });
    });
    (containers ?? []).forEach((container, index) => {
      const frame = place(containerBoxes[index]);
      centerById.set(container.id, { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 });
    });
  }

  return (
    <View style={[styles.canvas, { width, height }]}>
      {lanes.map((lane, index) => (
        <View key={`lane-${index}`} style={[styles.lane, place(lane)]} />
      ))}
      {detailed &&
        (shapes ?? []).map((shape, index) => {
          const frame = place(shapeBoxes[index]);
          const stroke = shape.color ?? '#6B7280';
          return (
            <View key={shape.id} style={[styles.shape, frame]}>
              <ShapeBody
                shape={shape}
                width={frame.width}
                height={frame.height}
                stroke={stroke}
                fill={shape.filled ? withAlpha(stroke, 0.15) : 'none'}
                ink={stroke}
              />
            </View>
          );
        })}
      {/* Behind the cards, the same order the real board draws them in -
          a line points AT a card, not over it. */}
      {detailed && (connections?.length ?? 0) > 0 && (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
          {(connections ?? []).map((connection) => {
            const from = centerById.get(connection.fromCardId);
            const to = centerById.get(connection.toCardId);
            if (!from || !to) return null;
            return (
              <Line
                key={connection.id}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="rgba(107,114,128,0.5)"
                strokeWidth={1}
              />
            );
          })}
        </Svg>
      )}
      {cards.map((card, index) => {
        const frame = place(boxes[index]);
        const type = card.type ?? 'paragraph';
        if (type === 'image' && card.imageUri) {
          return (
            <AttachmentImage
              key={card.id}
              uri={card.imageUri}
              driveFileId={card.driveFileId}
              style={[styles.card, frame]}
            />
          );
        }
        // A document or link card already carries its own cached picture
        // (the same one its full card shows on the board itself) - read
        // by name here too instead of falling back to a pale box, so the
        // map reads as the board's real content ("виглядає не зовсім
        // правдоподібно... він ніби вирізає всі елементи і підставляє їх
        // на якийсь фон").
        if (type === 'document' && card.documentPreviewImageUri) {
          return (
            <AttachmentImage
              key={card.id}
              uri={card.documentPreviewImageUri}
              driveFileId={card.documentPreviewDriveFileId}
              style={[styles.card, frame]}
            />
          );
        }
        if (type === 'link' && card.linkImageUrl) {
          return (
            <Image key={card.id} source={{ uri: card.linkImageUrl }} style={[styles.card, frame]} resizeMode="cover" />
          );
        }
        const isSticky = type === 'paragraph' && !!card.color;
        // A file or a board reference gets its own icon in a capture -
        // cheap to draw once, not worth measuring text for on every live
        // render of the boards list.
        if (detailed && frame.width > 10 && frame.height > 10 && (type === 'file' || type === 'board')) {
          return (
            <View key={card.id} style={[styles.card, frame, styles.plainCard, styles.iconCard]}>
              <Ionicons
                name={type === 'file' ? fileIconFor(card.fileName ?? '') : 'easel-outline'}
                size={Math.min(frame.width, frame.height) * 0.4}
                color="#6B7280"
              />
            </View>
          );
        }
        return (
          <View
            key={card.id}
            style={[styles.card, frame, isSticky ? { backgroundColor: card.color } : styles.plainCard]}
          >
            {(showText || detailed) && frame.height > 18 && (
              <Text style={styles.cardText} numberOfLines={Math.max(1, Math.floor(frame.height / 9))}>
                {card.text || card.documentTitle || card.linkTitle || card.fileTitle || card.boardTitle || ''}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    overflow: 'hidden',
  },
  lane: {
    position: 'absolute',
    borderRadius: 3,
    backgroundColor: 'rgba(17,24,39,0.06)',
  },
  card: {
    position: 'absolute',
    borderRadius: 2,
    overflow: 'hidden',
  },
  shape: {
    position: 'absolute',
  },
  plainCard: {
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  iconCard: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    fontSize: 4,
    fontFamily: FONT_REGULAR,
    lineHeight: 5,
    color: 'rgba(17,24,39,0.7)',
    paddingHorizontal: 2,
    paddingTop: 1,
  },
});
