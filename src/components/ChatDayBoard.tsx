import { ReactNode, useCallback, useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import type { ChatMessage } from '../utils/chat';

// THE CHAT AS A BOARD, first slice (2026-10-07): the same messages the tape
// shows, laid out as cards in one frame per day - «області-дні». A frame is
// the day's own and is not moved; the cards are the tape's messages drawn
// smaller, so nothing is copied and the tape is not touched. A pinch steps
// the cards between big, medium and small (the chat's own zoom: out far
// enough, a whole week is in sight at once). Free dragging and copies with a
// thread to the original come next.
export type BoardDay = { key: string; label: string; messages: ChatMessage[] };

// Columns per level, from near to far.
export const BOARD_COLS = [1, 2, 4] as const;
const OUTER = 16;
const FRAME_PAD = 8;
const GAP = 8;

export function boardCardWidth(width: number, level: number): number {
  const cols = BOARD_COLS[level] ?? 2;
  // Less the frame's own border (1.5 a side): without it the last card of a
  // row is two points too wide to fit and wraps.
  return Math.floor((width - OUTER * 2 - FRAME_PAD * 2 - 3 - GAP * (cols - 1)) / cols) - 1;
}

export default function ChatDayBoard({
  days,
  width,
  level,
  onLevel,
  paddingTop,
  paddingBottom,
  renderCard,
  labelColor,
  frameColor,
  frameFill,
}: {
  days: BoardDay[];
  width: number;
  level: number;
  // +1 = farther (smaller cards), -1 = nearer.
  onLevel: (step: 1 | -1) => void;
  paddingTop: number;
  paddingBottom: number;
  renderCard: (message: ChatMessage, cardWidth: number) => ReactNode;
  labelColor: string;
  frameColor: string;
  frameFill: string;
}) {
  const cardWidth = boardCardWidth(width, level);
  const pinch = useMemo(
    () =>
      Gesture.Pinch().onEnd((e) => {
        'worklet';
        if (e.scale < 0.8) runOnJS(onLevel)(1);
        else if (e.scale > 1.25) runOnJS(onLevel)(-1);
      }),
    [onLevel]
  );
  const renderDay = useCallback(
    ({ item }: { item: BoardDay }) => (
      <View style={[styles.frame, { borderColor: frameColor, backgroundColor: frameFill }]}>
        <Text style={[styles.label, { color: labelColor }]}>
          {item.label} · {item.messages.length}
        </Text>
        <View style={styles.cards}>{item.messages.map((m) => renderCard(m, cardWidth))}</View>
      </View>
    ),
    [cardWidth, renderCard, labelColor, frameColor, frameFill]
  );
  return (
    <GestureDetector gesture={pinch}>
      <View style={styles.fill}>
        <FlatList
          data={days}
          keyExtractor={(d) => d.key}
          renderItem={renderDay}
          // The width is part of the key: a new level re-lays every card.
          extraData={`${level}:${width}`}
          contentContainerStyle={{ paddingTop, paddingBottom }}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  frame: {
    marginHorizontal: OUTER,
    marginBottom: 14,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    padding: FRAME_PAD,
    gap: 6,
  },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3, paddingHorizontal: 4, paddingTop: 2 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
});
