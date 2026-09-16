import { useContext, useEffect, useState } from 'react';
import { NavigationContext } from '@react-navigation/native';
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
// The colour change. Nothing travels: two full-screen washes, each a
// fixed arrangement of the theme's clouds in different corners, stand
// over the tiled strip and only their OPACITY moves - up and down, each
// on its own period, so the corner that was sky becomes lilac and then
// mint without a single shape sliding. A first version moved blooms
// across the screen instead and read as waves (the user's word) rather
// than as colour; it also cost three oversized surfaces per screen.
// Opacity on a still layer is the cheapest animation Android has - the
// GPU blends the layer, nothing is redrawn.
const WASHES = [
  { period: 17000, corners: [[0.15, 0.2, 1], [0.9, 0.85, 2]] },
  { period: 26000, corners: [[0.85, 0.15, 2], [0.1, 0.8, 0]] },
] as const;
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

  // Only the screen in front animates. The tab navigator keeps every
  // screen mounted, and a wash fading behind a screen nobody sees is
  // exactly the work that made switching tabs stutter. Outside a
  // navigator (no context) the backdrop simply counts as focused.
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);
  useEffect(() => {
    if (!navigation) return;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);

  // One value per wash, 0 -> 1 -> 0 forever at its own pace. 'shimmer'
  // is the same fade twice as fast and a third stronger; 'still' never
  // starts it. A blurred screen holds whatever frame it was on.
  const fade = [useSharedValue(0), useSharedValue(0)];
  const moving = motion !== 'still' && cloud > 0 && focused;
  const pace = motion === 'shimmer' ? 0.5 : 1;
  const strength = motion === 'shimmer' ? 0.6 : 0.45;
  useEffect(() => {
    fade.forEach((value, i) => {
      cancelAnimation(value);
      if (!moving) return;
      // Resume from wherever the fade stopped rather than snapping: finish
      // the leg to the nearer end at the same speed, then loop the full
      // range from there.
      const rest = value.value;
      const near = rest > 0.5 ? 1 : 0;
      const period = WASHES[i].period * pace;
      value.value = withTiming(
        near,
        { duration: Math.abs(near - rest) * period, easing: Easing.inOut(Easing.sin) },
        () => {
          value.value = withRepeat(
            withTiming(1 - near, { duration: period, easing: Easing.inOut(Easing.sin) }),
            -1,
            true
          );
        }
      );
    });
    return () => fade.forEach((value) => cancelAnimation(value));
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

      {/* The colour change: two still washes, only their opacity moves. */}
      {cloud > 0 &&
        motion !== 'still' &&
        WASHES.map((wash, i) => (
          <Wash
            key={i}
            id={`${id}-wash-${i}`}
            colours={wash.corners.map(([cx, cy, c]) => [cx, cy, theme.clouds[c]] as const)}
            opacity={strength * cloud}
            width={width}
            height={height}
            fade={fade[i]}
          />
        ))}
    </View>
  );
}

// One wash: two soft radial spots in the corners the arrangement names,
// drawn once at screen size and never touched again - the only thing
// that changes is the layer's opacity, on the UI thread.
function Wash({
  id,
  colours,
  opacity,
  width,
  height,
  fade,
}: {
  id: string;
  colours: (readonly [number, number, string])[];
  opacity: number;
  width: number;
  height: number;
  fade: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({ opacity: fade.value }));
  const r = Math.max(width, height) * 0.7;
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents="none"
      renderToHardwareTextureAndroid
    >
      <Svg width={width} height={height}>
        <Defs>
          {colours.map(([cx, cy, colour], i) => (
            <RadialGradient
              key={i}
              id={`${id}-${i}`}
              cx={cx * width}
              cy={cy * height}
              r={r}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0" stopColor={colour} stopOpacity={opacity} />
              <Stop offset="1" stopColor={colour} stopOpacity="0" />
            </RadialGradient>
          ))}
        </Defs>
        {colours.map((_, i) => (
          <Rect key={i} width={width} height={height} fill={`url(#${id}-${i})`} />
        ))}
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
