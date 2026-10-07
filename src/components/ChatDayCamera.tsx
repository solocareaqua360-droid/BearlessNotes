import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';
import type { ChatMessage } from '../utils/chat';
import type { BoardDay } from './ChatDayBoard';

// THE CHAT'S BOARD AS A CAMERA over a table (2026-10-07, the user's «варіант 1»).
// The cards are laid out ONCE, two to a row, and never re-flow: a pinch moves
// the camera - the whole table gets bigger or smaller, nothing is rearranged.
// When the fingers lift, the camera settles on the nearest of three heights
// (the old «три стани»), and a pinch-out from the nearest one leaves the
// board for the tape, as it did.
//
// How it is built: one ScrollView, one box inside it that is drawn at
// `scale` (transform) and is given the height the scaled content really has
// (so the scroll range is right), centred sideways when it is smaller than
// the screen. Padding for the header and the dock lives OUTSIDE the box, in
// screen points, so it does not shrink with the table. While the scale
// changes - by a finger or by the settling - the point in the middle of the
// screen stays in the middle.
export const CAMERA_SNAPS = [1, 0.7, 0.5] as const;
const MIN_SCALE = 0.4;
const MAX_SCALE = 1.4;
const OUTER = 16;
const FRAME_PAD = 8;
const GAP = 8;

// Two to a row, as the old middle level was.
export function cameraCardWidth(width: number): number {
  return Math.floor((width - OUTER * 2 - FRAME_PAD * 2 - 3 - GAP) / 2) - 1;
}

// A copy on the table. `x` and `y` are in the table's own units; -1 means
// «not placed yet»: it lies in the free strip below the newest day, two to a
// row, until it is dragged somewhere.
export type CameraCopy = { id: string; messageId: string; x: number; y: number; node: ReactNode };
const AUTO_ROW = 230;

function CopyCard({
  id,
  x,
  y,
  scale,
  onMove,
  children,
}: {
  id: string;
  x: number;
  y: number;
  scale: { value: number };
  onMove: (id: string, x: number, y: number) => void;
  children: ReactNode;
}) {
  const px = useSharedValue(x);
  const py = useSharedValue(y);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  useEffect(() => {
    px.value = x;
    py.value = y;
  }, [x, y, px, py]);
  const pan = Gesture.Pan()
    .minDistance(6)
    .onStart(() => {
      'worklet';
      sx.value = px.value;
      sy.value = py.value;
    })
    .onUpdate((e) => {
      'worklet';
      // The finger moves in screen points; the table is drawn at `scale`.
      px.value = sx.value + e.translationX / scale.value;
      py.value = sy.value + e.translationY / scale.value;
    })
    .onEnd(() => {
      'worklet';
      runOnJS(onMove)(id, px.value, py.value);
    });
  const style = useAnimatedStyle(() => ({ left: px.value, top: py.value }));
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ position: 'absolute' }, style]}>{children}</Animated.View>
    </GestureDetector>
  );
}

export default function ChatDayCamera({
  days,
  width,
  height,
  snap,
  onSnap,
  onLeave,
  onEarlier,
  copies,
  onMoveCopy,
  paddingTop,
  paddingBottom,
  renderCard,
  labelColor,
  frameColor,
  frameFill,
}: {
  // Newest day LAST: the board opens on the newest, at the bottom.
  days: BoardDay[];
  width: number;
  // The visible height of the scroll area, for «the middle of the screen».
  height: number;
  snap: number;
  onSnap: (index: number) => void;
  onLeave: () => void;
  // Set when older days exist that are not drawn: a button at the top asks for a month more.
  onEarlier?: () => void;
  copies: CameraCopy[];
  onMoveCopy: (id: string, x: number, y: number) => void;
  paddingTop: number;
  paddingBottom: number;
  renderCard: (message: ChatMessage, cardWidth: number) => ReactNode;
  labelColor: string;
  frameColor: string;
  frameFill: string;
}) {
  const cardWidth = cameraCardWidth(width);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scale = useSharedValue<number>(CAMERA_SNAPS[snap] ?? 1);
  const baseH = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const viewH = useSharedValue(height);
  const startScale = useSharedValue(1);
  const padTop = useSharedValue(paddingTop);
  useEffect(() => {
    viewH.value = height;
    padTop.value = paddingTop;
  }, [height, paddingTop, viewH, padTop]);
  const placed = useRef(false);
  // Where every original card sits on the table, for the threads. Kept in
  // refs as the layouts arrive; a redraw is asked for only while there are
  // copies to draw threads to.
  const frameLay = useRef<Record<string, { x: number; y: number }>>({});
  const cardsLay = useRef<Record<string, { x: number; y: number }>>({});
  const cardLay = useRef<Record<string, { x: number; y: number; w: number; h: number; day: string }>>({});
  const [framesH, setFramesH] = useState(0);
  const [, setBump] = useState(0);
  const bumpQueued = useRef(false);
  const hasCopies = copies.length > 0;
  const askRedraw = useCallback(() => {
    if (!hasCopies || bumpQueued.current) return;
    bumpQueued.current = true;
    requestAnimationFrame(() => {
      bumpQueued.current = false;
      setBump((n) => n + 1);
    });
  }, [hasCopies]);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  // The middle of the screen stays where it is while the scale changes.
  useAnimatedReaction(
    () => scale.value,
    (now, before) => {
      if (before === null || before === now || baseH.value === 0) return;
      const mid = viewH.value / 2;
      const point = (scrollY.value + mid - padTop.value) / before;
      const y = Math.max(0, point * now + padTop.value - mid);
      scrollTo(scrollRef, 0, y, false);
      scrollY.value = y;
    }
  );

  // The snap chosen elsewhere (a new level) moves the camera to it.
  useEffect(() => {
    scale.value = withTiming(CAMERA_SNAPS[snap] ?? 1, { duration: 220 });
  }, [snap, scale]);

  const settle = useCallback(
    (raw: number) => {
      // Far enough past the nearest height: that is the way out to the tape.
      if (raw > 1.2 && snap === 0) {
        scale.value = withTiming(1, { duration: 160 });
        onLeave();
        return;
      }
      let best = 0;
      let bestDist = Infinity;
      CAMERA_SNAPS.forEach((s, i) => {
        const d = Math.abs(Math.log(s / raw));
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      scale.value = withTiming(CAMERA_SNAPS[best], { duration: 220 });
      if (best !== snap) onSnap(best);
    },
    [snap, onSnap, onLeave, scale]
  );

  const pinch = Gesture.Pinch()
    .onStart(() => {
      'worklet';
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      'worklet';
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale.value * e.scale));
    })
    .onEnd(() => {
      'worklet';
      runOnJS(settle)(scale.value);
    });

  // Copies not placed yet lie below the days, two to a row.
  const autoIds = copies.filter((c) => c.x < 0 || c.y < 0).map((c) => c.id);
  const resolve = (c: CameraCopy) => {
    if (c.x >= 0 && c.y >= 0) return { x: c.x, y: c.y };
    const i = autoIds.indexOf(c.id);
    return { x: OUTER + (i % 2) * (cardWidth + GAP), y: framesH + 16 + Math.floor(i / 2) * AUTO_ROW };
  };
  // The free strip is as tall as the lowest copy needs.
  const freeH = copies.reduce((m, c) => Math.max(m, resolve(c).y + AUTO_ROW - framesH), 0);

  const boxStyle = useAnimatedStyle(() => ({
    height: baseH.value * scale.value,
  }));
  const tableStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (width - width * scale.value) / 2 }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={pinch}>
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop, paddingBottom }}
      >
        <Animated.View style={boxStyle}>
          <Animated.View
            style={[styles.table, { width }, tableStyle]}
            onLayout={(e) => {
              baseH.value = e.nativeEvent.layout.height;
              // Opens on the newest day, at the bottom - once.
              if (!placed.current && e.nativeEvent.layout.height > 0) {
                placed.current = true;
                setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 0);
              }
            }}
          >
            {onEarlier && (
              <Pressable onPress={onEarlier} style={[styles.earlier, { borderColor: frameColor }]}>
                <Text style={[styles.label, { color: labelColor }]}>Раніше · ще місяць</Text>
              </Pressable>
            )}
            {hasCopies && (
              <Svg style={StyleSheet.absoluteFill} width={width} height={framesH + freeH} pointerEvents="none">
                {copies.map((c) => {
                  const spot = cardLay.current[c.messageId];
                  const from = spot && frameLay.current[spot.day] && cardsLay.current[spot.day];
                  if (!spot || !from) return null;
                  const at = resolve(c);
                  const ox = frameLay.current[spot.day].x + cardsLay.current[spot.day].x + spot.x + spot.w / 2;
                  const oy = frameLay.current[spot.day].y + cardsLay.current[spot.day].y + spot.y + spot.h / 2;
                  return (
                    <Line
                      key={c.id}
                      x1={ox}
                      y1={oy}
                      x2={at.x + cardWidth / 2}
                      y2={at.y + 24}
                      stroke={frameColor}
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                    />
                  );
                })}
              </Svg>
            )}
            <View onLayout={(e) => setFramesH(e.nativeEvent.layout.height)}>
              {days.map((day) => (
                <View
                  key={day.key}
                  style={[styles.frame, { borderColor: frameColor, backgroundColor: frameFill }]}
                  onLayout={(e) => {
                    frameLay.current[day.key] = { x: e.nativeEvent.layout.x, y: e.nativeEvent.layout.y };
                    askRedraw();
                  }}
                >
                  <Text style={[styles.label, { color: labelColor }]}>
                    {day.label} · {day.messages.length}
                  </Text>
                  <View
                    style={styles.cards}
                    onLayout={(e) => {
                      cardsLay.current[day.key] = { x: e.nativeEvent.layout.x, y: e.nativeEvent.layout.y };
                      askRedraw();
                    }}
                  >
                    {day.messages.map((m) => (
                      <View
                        key={m.id}
                        onLayout={(e) => {
                          const l = e.nativeEvent.layout;
                          cardLay.current[m.id] = { x: l.x, y: l.y, w: l.width, h: l.height, day: day.key };
                          askRedraw();
                        }}
                      >
                        {renderCard(m, cardWidth)}
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
            {hasCopies && <View style={{ height: freeH }} />}
            {copies.map((c) => {
              const at = resolve(c);
              return (
                <CopyCard key={c.id} id={c.id} x={at.x} y={at.y} scale={scale} onMove={onMoveCopy}>
                  {c.node}
                </CopyCard>
              );
            })}
          </Animated.View>
        </Animated.View>
      </Animated.ScrollView>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  table: { position: 'absolute', top: 0, left: 0, transformOrigin: 'left top' } as never,
  frame: {
    marginHorizontal: OUTER,
    marginBottom: 14,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    padding: FRAME_PAD,
    gap: 6,
  },
  earlier: {
    alignSelf: 'center',
    marginBottom: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1.5,
  },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3, paddingHorizontal: 4, paddingTop: 2 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
});
