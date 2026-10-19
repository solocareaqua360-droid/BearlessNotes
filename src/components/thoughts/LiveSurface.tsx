import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDecay, withTiming, type SharedValue } from 'react-native-reanimated';

// A SURFACE THAT LIVES UNDER THE FINGERS (2026-10-15, the user: «третій-четвертий екран потрібно вміти рухати
// пальцями ... навіть зумити ... але не вийти за межі, туди, де нічого немає; в центрі уваги залишається те місце,
// де є картки»). One finger moves it, two zoom it about the point between them (1x .. 2.5x); past an edge it only
// gives a little, and let go it comes back by one calm move - no swing (the user's rule for every motion here).
// What is inside is laid out in the surface's own points: (0,0) .. (width, height); taps inside report those.
const MAX = 2.5;
const RESIST = 0.3;
const SETTLE = { duration: 240, easing: Easing.out(Easing.cubic) };

export default function LiveSurface({
  width,
  height,
  scale: given,
  children,
}: {
  width: number;
  height: number;
  // Shared with what lives inside (a carried card divides its finger's travel by it).
  scale?: SharedValue<number>;
  children: ReactNode;
}) {
  const own = useSharedValue(1);
  const s = given ?? own;
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const s0 = useSharedValue(1);
  const x0 = useSharedValue(0);
  const y0 = useSharedValue(0);

  // How far the content may go at a scale: it always covers the view (zoomed in) or sits centred (at 1x).
  const range = (sc: number, view: number) => {
    'worklet';
    const size = view * sc;
    return size > view ? [view - size, 0] : [(view - size) / 2, (view - size) / 2];
  };
  const soft = (v: number, lo: number, hi: number) => {
    'worklet';
    if (v < lo) return lo - (lo - v) * RESIST;
    if (v > hi) return hi + (v - hi) * RESIST;
    return v;
  };
  const settle = () => {
    'worklet';
    const sc = Math.min(MAX, Math.max(1, s.value));
    if (sc !== s.value) s.value = withTiming(sc, SETTLE);
    const [lx, hx] = range(sc, width);
    const [ly, hy] = range(sc, height);
    const cx = Math.min(hx, Math.max(lx, tx.value));
    const cy = Math.min(hy, Math.max(ly, ty.value));
    if (cx !== tx.value) tx.value = withTiming(cx, SETTLE);
    if (cy !== ty.value) ty.value = withTiming(cy, SETTLE);
  };

  const pan = Gesture.Pan()
    .minDistance(8)
    .averageTouches(true)
    .onStart(() => {
      x0.value = tx.value;
      y0.value = ty.value;
    })
    .onUpdate((e) => {
      const [lx, hx] = range(s.value, width);
      const [ly, hy] = range(s.value, height);
      tx.value = soft(x0.value + e.translationX, lx, hx);
      ty.value = soft(y0.value + e.translationY, ly, hy);
    })
    .onEnd((e) => {
      const [lx, hx] = range(s.value, width);
      const [ly, hy] = range(s.value, height);
      const inX = tx.value >= lx && tx.value <= hx;
      const inY = ty.value >= ly && ty.value <= hy;
      // Inside: a glide with the hand's speed that stops at the edge. Outside: back in, one calm move.
      if (inX && inY && s.value >= 1) {
        tx.value = withDecay({ velocity: e.velocityX, deceleration: 0.994, clamp: [lx, hx] });
        ty.value = withDecay({ velocity: e.velocityY, deceleration: 0.994, clamp: [ly, hy] });
      } else settle();
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      s0.value = s.value;
      x0.value = tx.value;
      y0.value = ty.value;
    })
    .onUpdate((e) => {
      const raw = s0.value * e.scale;
      const sc = raw < 1 ? 1 - (1 - raw) * RESIST : raw > MAX ? MAX + (raw - MAX) * RESIST : raw;
      // The point between the fingers stays under them.
      tx.value = e.focalX - ((e.focalX - x0.value) * sc) / s0.value;
      ty.value = e.focalY - ((e.focalY - y0.value) * sc) / s0.value;
      s.value = sc;
    })
    .onEnd(() => settle());

  const look = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: s.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
      <View style={{ width, height, overflow: 'hidden' }}>
        <Animated.View style={[styles.content, { width, height }, look]}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  content: { position: 'absolute', left: 0, top: 0, transformOrigin: 'left top' },
});
