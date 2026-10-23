import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useSoft } from '../theme/soft';

// WHILE THE AI THINKS (2026-10-24, the user: no rainbow - it is another AI's mark). Two quiet effects around the composer,
// switchable, and off:
//  - 'fire': a warm orange glow like a campfire in the dark, breathing and flickering softly. Not a blur (a live blur on a
//    moving surface freezes on Android - see android_live_blur_moving_surface): a few stacked rounded Views whose opacity
//    falls off outwards, so only opacity changes.
//  - 'balloons': small balloons of the app's own shape rise slowly from the composer and fade out. Opacity and transform
//    only; the balloon is a static SVG.
// Nothing runs while `active` is false: the layer is not even mounted (it fades out first, then goes).

export type ThinkingVariant = 'fire' | 'balloons' | 'off';

const KEY = 'assistant.thinking.variant';
const ORDER: ThinkingVariant[] = ['fire', 'balloons', 'off'];

export const nextThinkingVariant = (v: ThinkingVariant): ThinkingVariant => ORDER[(ORDER.indexOf(v) + 1) % ORDER.length];
export const thinkingVariantLabel = (v: ThinkingVariant): string => (v === 'fire' ? 'Вогнище' : v === 'balloons' ? 'Кульки' : 'Вимкнено');

// The chosen effect, kept on the phone. Starts as 'fire' and takes the saved one when it has been read - never blocks a render.
export function useThinkingVariant(): [ThinkingVariant, (v: ThinkingVariant) => void] {
  const [variant, setVariant] = useState<ThinkingVariant>('fire');
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (alive && (raw === 'fire' || raw === 'balloons' || raw === 'off')) setVariant(raw);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const set = useCallback((v: ThinkingVariant) => {
    setVariant(v);
    try {
      AsyncStorage.setItem(KEY, v).catch(() => {});
    } catch {
      // Not kept this time; the choice still holds until the app closes.
    }
  }, []);
  return [variant, set];
}

// ---- fire ----

// How far each glow ring stands out from the pill, and how strong it is at its strongest (dark / light ground).
const RINGS = [
  { out: 2, dark: 0.5, light: 0.4 },
  { out: 7, dark: 0.3, light: 0.24 },
  { out: 13, dark: 0.17, light: 0.13 },
  { out: 21, dark: 0.08, light: 0.06 },
];

function FireRing({ index, breath, flicker, height, radius, color, strength }: { index: number; breath: SharedValue<number>; flicker: SharedValue<number>; height: number; radius: number; color: string; strength: number }) {
  const out = RINGS[index].out;
  const style = useAnimatedStyle(() => {
    // The inner rings breathe, the outer ones flicker more: a fire is steady at its heart and restless at its edge.
    const shake = 0.04 + index * 0.05;
    return {
      opacity: strength * (0.62 + 0.28 * breath.value) * (1 - shake + shake * 2 * flicker.value),
      transform: [{ scale: 1 + 0.012 * breath.value }],
    };
  });
  return <Animated.View style={[{ position: 'absolute', left: -out, right: -out, top: -out, bottom: -out, borderRadius: radius + out, backgroundColor: color }, style]} />;
}

function Fire({ height, radius, dark, accent }: { height: number; radius: number; dark: boolean; accent: string }) {
  const breath = useSharedValue(0);
  const flicker = useSharedValue(0.5);
  useEffect(() => {
    breath.value = withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) }), -1, true);
    flicker.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 170 }),
        withTiming(0.35, { duration: 250 }),
        withTiming(0.85, { duration: 140 }),
        withTiming(0.1, { duration: 330 }),
        withTiming(0.7, { duration: 210 }),
        withTiming(0.45, { duration: 260 })
      ),
      -1,
      false
    );
  }, [breath, flicker]);
  const amber = dark ? '#F5B25C' : '#F0A24A';
  return (
    <>
      {RINGS.map((r, i) => (
        <FireRing
          key={r.out}
          index={i}
          breath={breath}
          flicker={flicker}
          height={height}
          radius={radius}
          // The heart is amber, the edge is the app's orange.
          color={i < 2 ? amber : accent}
          strength={dark ? r.dark : r.light}
        />
      ))}
    </>
  );
}

// ---- balloons ----

const BALLOONS: { left: string; size: number; rise: number; duration: number; delay: number; sway: number; tone: 0 | 1 | 2 }[] = [
  { left: '8%', size: 18, rise: 150, duration: 5200, delay: 0, sway: 9, tone: 0 },
  { left: '27%', size: 14, rise: 120, duration: 4300, delay: 1500, sway: 7, tone: 1 },
  { left: '46%', size: 21, rise: 175, duration: 6000, delay: 600, sway: 11, tone: 2 },
  { left: '64%', size: 15, rise: 130, duration: 4700, delay: 2600, sway: 8, tone: 0 },
  { left: '82%', size: 19, rise: 160, duration: 5600, delay: 1100, sway: 10, tone: 1 },
];

function Balloon({ spec, color }: { spec: (typeof BALLOONS)[number]; color: string }) {
  const p = useSharedValue(0);
  const sway = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withDelay(spec.delay, withTiming(1, { duration: spec.duration, easing: Easing.linear })), -1, false);
    sway.value = withRepeat(withTiming(1, { duration: 1900 + spec.size * 40, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [p, sway, spec]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.14, 0.7, 1], [0, 0.95, 0.55, 0]),
    transform: [{ translateY: -p.value * spec.rise }, { translateX: (sway.value - 0.5) * 2 * spec.sway }],
  }));
  return (
    <Animated.View style={[{ position: 'absolute', top: -spec.size, left: spec.left as never, width: spec.size, height: spec.size * 1.4 }, style]}>
      <Svg width={spec.size} height={spec.size * 1.4} viewBox="0 0 24 34">
        {/* The balloon (the app's own, as BalloonMark draws it), its knot, its string. */}
        <Path d="M12 2c4.4 0 7.5 3.3 7.5 7.4 0 4.6-3.7 8.5-7.5 9.4-3.8-.9-7.5-4.8-7.5-9.4C4.5 5.3 7.6 2 12 2z" fill={color} />
        <Path d="M10.8 19.6l1.2 1.7 1.2-1.7z" fill={color} />
        <Path d="M12 21.3c-1.1 1.9 1.1 3 0 5.2" stroke={color} strokeWidth={1.2} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

function Balloons({ dark, accent }: { dark: boolean; accent: string }) {
  // The three tones of the «Думки» balloons: the app's orange, a cream, a warm sand.
  const tones = [accent, dark ? '#EDE3D2' : '#F3E9D6', dark ? '#C9A27A' : '#E3B98A'];
  return (
    <>
      {BALLOONS.map((spec, i) => (
        <Balloon key={i} spec={spec} color={tones[spec.tone]} />
      ))}
    </>
  );
}

// ---- the layer ----

export default function ThinkingEffect({
  active,
  variant,
  height = 56,
  radius = 28,
  bottom = 14,
  inset = 10,
}: {
  active: boolean;
  variant: ThinkingVariant;
  // The composer pill it sits around.
  height?: number;
  radius?: number;
  bottom?: number;
  inset?: number;
}) {
  const S = useSoft();
  const on = active && variant !== 'off';
  const [mounted, setMounted] = useState(on);
  const master = useSharedValue(0);
  useEffect(() => {
    if (on) {
      setMounted(true);
      master.value = withTiming(1, { duration: 280 });
    } else {
      master.value = withTiming(0, { duration: 320 }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [on, master]);
  const fade = useAnimatedStyle(() => ({ opacity: master.value }));
  if (!mounted) return null;
  return (
    <View pointerEvents="none" style={[styles.layer, { left: inset, right: inset, bottom, height }]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, fade]}>
        {variant === 'balloons' ? <Balloons dark={S.dark} accent={S.accent} /> : <Fire height={height} radius={radius} dark={S.dark} accent={S.accent} />}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Overflow stays visible: the glow stands outside the pill and the balloons rise above it.
  layer: { position: 'absolute', overflow: 'visible' },
});
