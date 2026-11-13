import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { SOFT_BOLD, SOFT_SEMIBOLD } from '../../utils/fonts';

// THE THEMES AS CLOUDS (2026-10-15, the user's: «плаваючі хмаринки», a theme you tap rather than a list you read).
// A cloud's size says how many thoughts it holds, its strength how recently it was touched; every cloud drifts a
// little, slowly and on its own beat - presence, not a notification. Laid out once by a small packing (largest in
// the middle, the rest around it without overlapping); the drift is only a few points, so a finger aimed at a cloud
// still finds it.

export type CloudLook = { from: string; to: string; ink: string; sub: string };
export type CloudPlace = { id: string; x: number; y: number; d: number };

export function cloudDiameter(count: number, small = false) {
  const base = small ? 54 : 84;
  const step = small ? 4 : 9;
  return base + Math.min(count, 10) * step;
}

// Centres for circles of the given diameters inside w x h: the biggest first, in the middle, each next one on a
// golden-angle spiral at the first spot where it touches nothing.
export function layoutClouds(items: { id: string; d: number }[], w: number, h: number, gap = 12): CloudPlace[] {
  const placed: CloudPlace[] = [];
  const sorted = [...items].sort((a, b) => b.d - a.d);
  const cx = w / 2;
  const cy = h / 2;
  sorted.forEach((it, i) => {
    let best: CloudPlace | null = null;
    for (let k = 0; k < 900; k++) {
      const a = k * 2.39996 + i;
      const r = k * 2.2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.92;
      const rad = it.d / 2;
      if (x - rad < 4 || x + rad > w - 4 || y - rad < 4 || y + rad > h - 4) continue;
      if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.d / 2 + rad + gap)) {
        best = { id: it.id, x, y, d: it.d };
        break;
      }
    }
    placed.push(best ?? { id: it.id, x: cx + (i % 3) * 20, y: cy + i * 6, d: it.d });
  });
  return placed;
}

export function Cloud({
  place,
  look,
  label,
  sub,
  beat,
  dashed,
  faded,
  glow,
  pulse,
  hover,
  small,
}: {
  place: CloudPlace;
  look: CloudLook;
  label: string;
  sub?: string;
  // Which drift: a cloud's own pace and direction.
  beat: number;
  dashed?: boolean;
  faded?: boolean;
  glow?: boolean;
  // Raised from outside when something lands in it (the swallow).
  pulse?: SharedValue<number>;
  // The id of the cloud a carried thought is over right now: that one swells a little and glows, so the finger knows
  // where it will land before letting go.
  hover?: SharedValue<string>;
  small?: boolean;
}) {
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const born = useSharedValue(0);
  useEffect(() => {
    const dur = 7000 + (beat % 5) * 1300;
    const ax = (beat % 2 ? 1 : -1) * (5 + (beat % 3) * 2);
    const ay = (beat % 3 ? -1 : 1) * (4 + (beat % 4));
    const ease = Easing.inOut(Easing.sin);
    dx.value = withRepeat(withSequence(withTiming(ax, { duration: dur, easing: ease }), withTiming(-ax * 0.6, { duration: dur, easing: ease })), -1, true);
    dy.value = withRepeat(withSequence(withTiming(ay, { duration: dur * 1.2, easing: ease }), withTiming(-ay * 0.7, { duration: dur * 1.2, easing: ease })), -1, true);
    // Each cloud surfaces in its turn, a breath apart.
    born.value = withDelay(60 * (beat % 8), withSpring(1, { damping: 16, stiffness: 140 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const over = useSharedValue(0);
  const id = place.id;
  // Not written from inside the style (a style must not change shared values): a reaction does it.
  useAnimatedReaction(
    () => (hover ? hover.value === id : false),
    (on, was) => {
      if (on !== was) over.value = withSpring(on ? 1 : 0, { damping: 15, stiffness: 220 });
    }
  );
  const move = useAnimatedStyle(() => {
    return {
      opacity: born.value * (faded ? 0.72 + over.value * 0.28 : 1),
      transform: [
        { translateX: dx.value },
        { translateY: dy.value },
        { scale: (0.85 + born.value * 0.15) * (pulse ? 1 + pulse.value * 0.12 : 1) * (1 + over.value * 0.14) },
      ],
    };
  });
  const ring = useAnimatedStyle(() => ({ opacity: over.value, transform: [{ scale: 1 + over.value * 0.06 }] }));
  const d = place.d;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.cloud,
        { left: place.x - d / 2, top: place.y - d / 2, width: d, height: d, borderRadius: d / 2 },
        dashed ? styles.dashed : { backgroundColor: look.to, experimental_backgroundImage: `radial-gradient(circle at 40% 35%, ${look.from}, ${look.to})` },
        glow && { boxShadow: `0px 0px 0px 6px ${look.to}55, 0px 0px 32px ${look.to}88` },
        move,
      ]}
    >
      {!!hover && <Animated.View pointerEvents="none" style={[styles.ring, { borderRadius: d / 2 + 8 }, ring]} />}
      {/* Whole words: a long word shrinks to fit rather than breaking in the middle («tstte / ma»). */}
      <Text
        style={[small ? styles.labelSmall : d > 130 ? styles.labelBig : styles.label, { color: look.ink }]}
        numberOfLines={/\s/.test(label.trim()) ? 2 : 1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        textBreakStrategy="simple"
      >
        {label}
      </Text>
      {!!sub && (
        <Text style={[styles.sub, { color: look.sub }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {sub}
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cloud: { position: 'absolute', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  ring: { position: 'absolute', left: -8, right: -8, top: -8, bottom: -8, borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
  dashed: { borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(216,213,205,0.7)' },
  label: { fontSize: 14, fontFamily: SOFT_BOLD, textAlign: 'center' },
  labelBig: { fontSize: 17, fontFamily: SOFT_BOLD, textAlign: 'center' },
  labelSmall: { fontSize: 12, fontFamily: SOFT_SEMIBOLD, textAlign: 'center' },
  sub: { fontSize: 12, fontFamily: SOFT_SEMIBOLD, marginTop: 2 },
});
