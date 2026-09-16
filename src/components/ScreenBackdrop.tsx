import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  SharedValue,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useMotion, useTheme } from '../theme/ThemeProvider';

// What every screen stands on, and what the glass has to blur.
//
// It used to be one flat gradient pinned to the window: nothing under the
// rail ever moved, so the capsules blurred the same three colours
// forever. Now that the lists keep clear of the rail (see RAIL_CLEARANCE)
// not even a card passes behind it, so the backdrop itself has to move.
//
// The user's own answer to "no picture is long enough for a list of any
// length": a PATTERN that repeats. One tile of soft colour clouds is
// drawn once and tiled down a strip a tile taller than the window; the
// strip slides by the scroll offset MODULO the tile, so it can never run
// out however far the list goes - and because it repeats, the drift can
// be quick enough for the colours to actually change under the glass.
//
// A first attempt moved the whole layer instead of the strip inside it,
// and the screen simply ran out into white below. The frame stands
// still; only the strip within it slides.
//
// Still react-native-svg, not expo-linear-gradient: that would be a new
// native module and another dev-client build.
//
// What the THEME decides here (slice 2 of the themes work): the colour
// theme is everything below, unchanged, in the colours the screen asks
// for. The white theme keeps the very same drifting clouds - the user
// asked for them rather than a flat sheet of paper - bleached to a
// tenth of their strength over white, so there is still something under
// the glass for it to be glass over. The black theme has no clouds at
// all: light on black is the glow on the drops, and a cloud behind them
// would only grey it.
const TILE = 360;
// The slow ones. Three blooms, each on its own period so they never come
// back to the same arrangement twice - which is what makes a drift read
// as weather rather than as a loop. Periods are deliberately coprime-ish
// and long: the user's reference (Gemini's answering screen) stirs, it
// does not pulse.
const BLOOMS = [
  { period: 23000, dx: 0.16, dy: 0.10, from: 0.9, to: 1.18 },
  { period: 31000, dx: -0.13, dy: 0.14, from: 1.12, to: 0.92 },
  { period: 19000, dx: 0.09, dy: -0.12, from: 0.96, to: 1.22 },
];
// A fraction of the list's own speed. Fast enough that a normal scroll
// carries a cloud right through a capsule, slow enough to read as depth.
const DRIFT = 0.55;

export default function ScreenBackdrop({
  id,
  colors,
  scrollY,
}: {
  // A gradient's id has to be unique in the document - each screen passes
  // its own, as they did when every screen drew this itself.
  id: string;
  colors: [string, string, string];
  // Absent (a screen with no list of its own) - the clouds simply stand
  // still, and the screen is the gradient it always was.
  scrollY?: SharedValue<number>;
}) {
  // Its OWN size, measured - not the window's. In a pane the screen is
  // half a window, and a backdrop drawn to the window's width put the
  // clouds where they would be on a whole screen and ran off the pane's
  // edge: the user saw it as "the backdrop is shifted", and it was the
  // one visible sign that the screen inside was being laid out for a
  // width it did not have. The window's size only stands in until the
  // first layout, so nothing flashes white.
  const theme = useTheme();
  const motion = useMotion();
  const window = useWindowDimensions();
  const [own, setOwn] = useState<{ width: number; height: number } | null>(null);
  const width = own?.width ?? window.width;
  const height = own?.height ?? window.height;
  const stripHeight = height + TILE * 2;
  // White and black answer for their own ground; only the colour theme
  // lets each screen keep the gradient it was written with.
  const ramp: [string, string, string] =
    theme.backdrop === 'gradient' ? colors : [theme.ground, theme.ground, theme.ground];
  // How much of a cloud survives. Bleached almost away in white; gone in
  // black.
  const cloud = theme.cloudStrength;

  // One value per bloom, each running 0 -> 1 -> 0 forever at its own
  // pace. 'shimmer' is the same movement at twice the speed and half
  // again the distance; 'still' never starts them, so nothing is
  // animating behind a screen someone is reading.
  const drift = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const moving = motion !== 'still' && cloud > 0;
  const pace = motion === 'shimmer' ? 0.5 : 1;
  const reach = motion === 'shimmer' ? 1.5 : 1;
  useEffect(() => {
    drift.forEach((value, i) => {
      cancelAnimation(value);
      value.value = 0;
      if (!moving) return;
      value.value = withRepeat(
        withTiming(1, { duration: BLOOMS[i].period * pace, easing: Easing.inOut(Easing.sin) }),
        -1,
        true
      );
    });
    return () => drift.forEach((value) => cancelAnimation(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, pace]);

  const style = useAnimatedStyle(() => {
    // Modulo the tile: at one tile of travel the strip is exactly back
    // where it started, so the next tile stands where the last one was
    // and nothing is ever missing at the bottom.
    const travel = ((scrollY?.value ?? 0) * DRIFT) % TILE;
    return { transform: [{ translateY: -travel }] };
  });

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.frame]}
      pointerEvents="none"
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setOwn((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }}
    >
      {/* The gradient stays where it is: it is the screen's own colour,
          top to bottom, and it must not slide with the clouds. 1px bled
          past every edge - the window size can round to a hair less than
          the real screen, leaving a sliver of white. */}
      <Svg width={width + 2} height={height + 2} style={styles.bleed} pointerEvents="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor={ramp[0]} />
            <Stop offset="0.52" stopColor={ramp[1]} />
            <Stop offset="1" stopColor={ramp[2]} />
          </LinearGradient>
        </Defs>
        <Rect width={width + 2} height={height + 2} fill={`url(#${id})`} />
      </Svg>

      <Animated.View style={[styles.strip, style]} pointerEvents="none">
        <Svg width={width} height={stripHeight} pointerEvents="none">
          <Defs>
            {/* Each cloud fades to nothing at its own edge, so a tile has
                no seam to hide - what meets at the join is transparent on
                both sides. */}
            <RadialGradient id={`${id}-a`} cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor={theme.clouds[0]} stopOpacity={0.55 * cloud} />
              <Stop offset="1" stopColor={theme.clouds[0]} stopOpacity="0" />
            </RadialGradient>
            <RadialGradient id={`${id}-b`} cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor={theme.clouds[1]} stopOpacity={0.5 * cloud} />
              <Stop offset="1" stopColor={theme.clouds[1]} stopOpacity="0" />
            </RadialGradient>
            <RadialGradient id={`${id}-c`} cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor={theme.clouds[2]} stopOpacity={0.45 * cloud} />
              <Stop offset="1" stopColor={theme.clouds[2]} stopOpacity="0" />
            </RadialGradient>
            {/* The tile itself. Three clouds at different depths across
                the width, none of them touching the tile's edge. */}
            <Pattern id={`${id}-tile`} x="0" y="0" width={width} height={TILE} patternUnits="userSpaceOnUse">
              <Rect x={width * 0.3} y={-TILE * 0.05} width={width * 0.95} height={TILE * 0.55} fill={`url(#${id}-a)`} />
              <Rect x={-width * 0.15} y={TILE * 0.25} width={width * 0.9} height={TILE * 0.5} fill={`url(#${id}-b)`} />
              <Rect x={width * 0.45} y={TILE * 0.55} width={width * 0.8} height={TILE * 0.5} fill={`url(#${id}-c)`} />
            </Pattern>
          </Defs>
          <Rect width={width} height={stripHeight} fill={`url(#${id}-tile)`} />
        </Svg>
      </Animated.View>

      {/* The drift. Each bloom is one radial gradient in its own layer,
          moved by a transform - so the colours cross and mix where they
          overlap without a single pixel being redrawn: the whole effect
          runs on the UI thread as three transforms, which is what makes
          it affordable behind a scrolling list. */}
      {moving &&
        BLOOMS.map((bloom, i) => (
          <Bloom
            key={i}
            id={`${id}-bloom-${i}`}
            colour={theme.clouds[i]}
            opacity={0.35 * cloud}
            width={width}
            height={height}
            drift={drift[i]}
            dx={bloom.dx * reach}
            dy={bloom.dy * reach}
            from={bloom.from}
            to={bloom.to}
          />
        ))}
    </View>
  );
}

// One drifting bloom: a soft radial gradient twice the screen across, so
// that even at the end of its travel no edge of it can reach the screen's
// own edge and show as a circle.
function Bloom({
  id,
  colour,
  opacity,
  width,
  height,
  drift,
  dx,
  dy,
  from,
  to,
}: {
  id: string;
  colour: string;
  opacity: number;
  width: number;
  height: number;
  drift: SharedValue<number>;
  dx: number;
  dy: number;
  from: number;
  to: number;
}) {
  const size = Math.max(width, height) * 1.6;
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: drift.value * dx * width },
      { translateY: drift.value * dy * height },
      { scale: from + (to - from) * drift.value },
    ],
  }));
  return (
    <Animated.View
      style={[
        styles.bloom,
        { width: size, height: size, left: (width - size) / 2, top: (height - size) / 2 },
        style,
      ]}
      pointerEvents="none"
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colour} stopOpacity={opacity} />
            <Stop offset="1" stopColor={colour} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bloom: {
    position: 'absolute',
  },
  frame: {
    overflow: 'hidden',
  },
  bleed: {
    position: 'absolute',
    top: -1,
    left: -1,
  },
  strip: {
    position: 'absolute',
    top: -TILE,
    left: 0,
  },
});
