import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedProps,
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

// The table can be slid sideways between its two side fields (a card's width
// each, where copies will lie). `tx` is the screen x of the table's left
// edge; this keeps the visible part inside the table with its fields, and
// centres the table when it is smaller than the screen.
function clampTx(t: number, s: number, width: number, gutter: number): number {
  'worklet';
  const lo = width - s * (width + gutter);
  const hi = s * gutter;
  if (lo > hi) return (width - s * width) / 2;
  return Math.min(hi, Math.max(lo, t));
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
  const gutter = cardWidth + 12;
  const tx = useSharedValue(clampTx(0, CAMERA_SNAPS[snap] ?? 1, width, gutter));
  // The screen point the table is scaled around while it settles: where the
  // fingers were (or the tap).
  const anchorX = useSharedValue(width / 2);
  const anchorY = useSharedValue(height / 2);
  const gesturing = useSharedValue(false);
  // True from the lift of the fingers (or a double tap) until the camera has
  // come to rest: the board's own scroll events say nothing true meanwhile.
  const settling = useSharedValue(false);
  const startScale = useSharedValue(1);
  const startTx = useSharedValue(0);
  const startScroll = useSharedValue(0);
  const startFx = useSharedValue(0);
  const startFy = useSharedValue(0);
  const padTop = useSharedValue(paddingTop);
  useEffect(() => {
    viewH.value = height;
    padTop.value = paddingTop;
  }, [height, paddingTop, viewH, padTop]);
  // Stays at the bottom (the newest day) until the finger first moves the board.
  const stick = useRef(true);
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

  // While the camera moves the scroll position, WE are the truth about it: a
  // scroll event that was already on its way would put an old offset back
  // and every following frame would be worked out from it (that was the
  // «chaotic» zoom of the first version).
  const onScroll = useAnimatedScrollHandler((e) => {
    if (gesturing.value || settling.value) return;
    scrollY.value = e.contentOffset.y;
  });
  // The board's own finger-scroll must not run alongside two fingers.
  const scrollProps = useAnimatedProps(() => ({ scrollEnabled: !gesturing.value }));

  // While the scale changes by itself (settling on a height), the point
  // under the anchor stays under it. A pinch does the same by its own hand.
  useAnimatedReaction(
    () => scale.value,
    (now, before) => {
      if (gesturing.value || before === null || before === now || baseH.value === 0) return;
      const wx = (anchorX.value - tx.value) / before;
      const wy = (scrollY.value + anchorY.value - padTop.value) / before;
      tx.value = clampTx(anchorX.value - now * wx, now, width, gutter);
      const y = Math.max(0, padTop.value + now * wy - anchorY.value);
      scrollTo(scrollRef, 0, y, false);
      scrollY.value = y;
    }
  );

  // The snap chosen elsewhere (a new level) moves the camera to it.
  useEffect(() => {
    scale.value = withTiming(CAMERA_SNAPS[snap] ?? 1, { duration: 220 }, () => {
      'worklet';
      settling.value = false;
    });
  }, [snap, scale]);

  const settle = useCallback(
    (raw: number) => {
      // Far enough past the nearest height: that is the way out to the tape.
      if (raw > 1.2 && snap === 0) {
        scale.value = withTiming(1, { duration: 160 }, () => {
          'worklet';
          settling.value = false;
        });
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
      scale.value = withTiming(CAMERA_SNAPS[best], { duration: 220 }, () => {
        'worklet';
        settling.value = false;
      });
      if (best !== snap) onSnap(best);
    },
    [snap, onSnap, onLeave, scale, settling]
  );

  // Two fingers: the table is scaled around the point between them AND
  // follows them, so sliding both fingers moves it. Every frame is worked
  // out from where the gesture began, not from the last frame, so a clamp
  // or a late scroll cannot pile up an error.
  const pinch = Gesture.Pinch()
    .onStart((e) => {
      'worklet';
      gesturing.value = true;
      startScale.value = scale.value;
      startTx.value = tx.value;
      startScroll.value = scrollY.value;
      startFx.value = e.focalX;
      startFy.value = e.focalY;
    })
    .onUpdate((e) => {
      'worklet';
      const s1 = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale.value * e.scale));
      const wx = (startFx.value - startTx.value) / startScale.value;
      const wy = (startScroll.value + startFy.value - padTop.value) / startScale.value;
      scale.value = s1;
      tx.value = clampTx(e.focalX - s1 * wx, s1, width, gutter);
      const y = Math.max(0, padTop.value + s1 * wy - e.focalY);
      scrollTo(scrollRef, 0, y, false);
      scrollY.value = y;
      anchorX.value = e.focalX;
      anchorY.value = e.focalY;
    })
    .onEnd(() => {
      'worklet';
      settling.value = true;
      gesturing.value = false;
      runOnJS(settle)(scale.value);
    })
    .onFinalize(() => {
      'worklet';
      gesturing.value = false;
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

  // A double tap steps the camera to the next height (and round again): the
  // same settling a pinch ends in, for a mouse, a steady hand, or a check.
  const cycle = useCallback(() => onSnap((snap + 1) % CAMERA_SNAPS.length), [snap, onSnap]);
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e, ok) => {
      'worklet';
      if (!ok) return;
      anchorX.value = e.x;
      anchorY.value = e.y;
      settling.value = true;
      runOnJS(cycle)();
    });
  const gesture = Gesture.Simultaneous(pinch, doubleTap);

  const boxStyle = useAnimatedStyle(() => ({
    height: baseH.value * scale.value,
  }));
  const tableStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.ScrollView
        ref={scrollRef}
        animatedProps={scrollProps}
        onScroll={onScroll}
        onScrollBeginDrag={() => {
          stick.current = false;
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop, paddingBottom }}
      >
        <Animated.View style={boxStyle}>
          <Animated.View
            style={[styles.table, { width }, tableStyle]}
            onLayout={(e) => {
              baseH.value = e.nativeEvent.layout.height;
              if (stick.current && e.nativeEvent.layout.height > 0) {
                setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 30);
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
