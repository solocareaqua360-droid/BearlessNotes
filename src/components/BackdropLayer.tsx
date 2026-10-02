import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useActiveBackdropOverride, useTheme } from '../theme/ThemeProvider';
import { useCachedAttachment } from '../hooks/useCachedAttachment';
import { listenWallpaperBoost, wallpaperBoosted } from '../utils/wallpaperBoost';

// THE USER'S OWN PICTURE under the whole app («Фон застосунку» →
// «Зображення»), blurred as the slider says. Drawn ONCE, at the root,
// under the navigator - the soft style's screens only lay their veil
// over it (ScreenGround).
//
// SMOOTH BLUR (2026-10-02: "немає плавності розмиття, інколи блимає"):
// blurring the picture again for every step of the slider can never be
// smooth - each step decodes and blurs anew, and the frame in between
// shows. So the picture is blurred at a few fixed LEVELS, each one once,
// and the blur in between is two neighbouring levels crossfaded: moving
// the slider only changes opacities. A level is mounted a step before it
// is needed (at opacity 0), so it has loaded by the time it shows; one
// still loading shows the level under it, never a hole. The theme's
// ground lies under everything, so nothing behind the app shows through.
//
// While the calendar or the databases are out (wallpaperBoost) the blur
// goes twice as deep, never under a soft one - option Б - and glides
// there through the same levels.
const LEVELS = [0, 3, 6, 10, 14, 19, 25, 32, 40, 50, 60];
const MAX_BLUR = 30;
const BOOST_MIN = 12;

// A radius as a position between levels: 12 -> 3.5.
function indexOf(radius: number): number {
  for (let i = 1; i < LEVELS.length; i++) {
    if (radius <= LEVELS[i]) return i - 1 + (radius - LEVELS[i - 1]) / (LEVELS[i] - LEVELS[i - 1]);
  }
  return LEVELS.length - 1;
}

function Level({ i, level, uri }: { i: number; level: SharedValue<number>; uri: string }) {
  // Opaque at and below where the blur stands (the ones below are hidden
  // by it), the next one up crossfading in, the rest clear.
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, 1 - (i - level.value))) }), [i]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Image source={{ uri }} blurRadius={LEVELS[i]} resizeMode="cover" style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

export default function BackdropLayer() {
  const theme = useTheme();
  const override = useActiveBackdropOverride();
  const image = override?.type === 'image' ? override : null;
  const status = useCachedAttachment(image?.uri, image?.driveFileId);
  const [boosted, setBoosted] = useState(wallpaperBoosted);
  useEffect(() => listenWallpaperBoost(setBoosted), []);
  const base = image ? (image.blur / 100) * MAX_BLUR : 0;
  const target = indexOf(boosted ? Math.min(LEVELS[LEVELS.length - 1], Math.max(base * 2, BOOST_MIN)) : base);

  const level = useSharedValue(target);
  // Which levels to keep mounted: around where the blur was and where it
  // is going, one step either side - so a glide (a drawer's boost) has
  // its levels loaded along the way.
  const previous = useRef(target);
  const [range, setRange] = useState<[number, number]>([Math.floor(target) - 1, Math.ceil(target) + 1]);
  useEffect(() => {
    const from = previous.current;
    previous.current = target;
    setRange([Math.floor(Math.min(from, target)) - 1, Math.ceil(Math.max(from, target)) + 1]);
    level.value = withTiming(target, { duration: Math.abs(target - from) > 1.5 ? 260 : 120 });
    // Once there, only the neighbours of where it stands stay mounted.
    const settle = setTimeout(() => setRange([Math.floor(target) - 1, Math.ceil(target) + 1]), 400);
    return () => clearTimeout(settle);
  }, [target, level]);

  if (!image || status !== 'ready') return null;
  const indices: number[] = [];
  for (let i = Math.max(0, range[0]); i <= Math.min(LEVELS.length - 1, range[1]); i++) indices.push(i);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.ground }]} pointerEvents="none">
      {indices.map((i) => (
        <Level key={`${image.uri}-${i}`} i={i} level={level} uri={image.uri} />
      ))}
    </View>
  );
}
