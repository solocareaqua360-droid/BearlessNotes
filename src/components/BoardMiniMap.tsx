import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AttachmentImage from './AttachmentImage';
import { BoardCard, BoardColumn } from '../types';
import { APPROX_CARD_HEIGHT, COLUMN_MIN_HEIGHT, COLUMN_WIDTH, fileIconFor } from '../utils/boardLayout';
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
  width,
  height,
  showText,
  detailed,
}: {
  cards: BoardCard[];
  columns?: BoardColumn[];
  width: number;
  height: number;
  // Text cards draw a couple of lines standing in for their words - only
  // worth it on a tile big enough for them to be lines rather than specks.
  showText?: boolean;
  // Reserved for the one-time capture (BoardMiniature): a sticky's own
  // text, a file's icon, a board-reference's title - readable in a
  // screenshot that is drawn once, too much text-measuring work to redo
  // on every list render of every board.
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
  const all = [...lanes, ...boxes];
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

  return (
    <View style={[styles.canvas, { width, height }]}>
      {lanes.map((lane, index) => (
        <View key={`lane-${index}`} style={[styles.lane, place(lane)]} />
      ))}
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
