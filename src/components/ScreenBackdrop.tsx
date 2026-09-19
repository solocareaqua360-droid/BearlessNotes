import { useState } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useActiveBackdropOverride, useTheme } from '../theme/ThemeProvider';
import { useCachedAttachment } from '../hooks/useCachedAttachment';

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
// A fraction of the list's own speed. Fast enough that a normal scroll
// carries a cloud right through a capsule, slow enough to read as depth.
const DRIFT = 0.55;

export default function ScreenBackdrop({
  id,
  scrollY,
}: {
  // A gradient's id has to be unique in the document - each screen passes
  // its own, as they did when every screen drew this itself.
  id: string;
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
  const window = useWindowDimensions();
  const override = useActiveBackdropOverride();
  const [own, setOwn] = useState<{ width: number; height: number } | null>(null);
  const width = own?.width ?? window.width;
  const height = own?.height ?? window.height;
  const stripHeight = height + TILE * 2;
  // A custom GRADIENT stands in for `wash` entirely, whatever the theme
  // would otherwise have drawn - 2 to 4 stops, evenly spaced, and no
  // clouds on top of it (the whole point was the user's OWN colours,
  // not this file adding its own drift to them).
  const ramp: string[] =
    override?.type === 'gradient'
      ? override.colors
      : theme.backdrop === 'gradient'
        ? theme.wash
        : [theme.ground, theme.ground, theme.ground];
  // How much of a cloud survives. Bleached almost away in white; gone in
  // black; gone entirely once a custom backdrop of either kind is on.
  const cloud = override ? 0 : theme.cloudStrength;
  const imageStatus = useCachedAttachment(
    override?.type === 'image' ? override.uri : undefined,
    override?.type === 'image' ? override.driveFileId : undefined
  );

  const style = useAnimatedStyle(() => {
    // Modulo the tile: at one tile of travel the strip is exactly back
    // where it started, so the next tile stands where the last one was
    // and nothing is ever missing at the bottom.
    const travel = ((scrollY?.value ?? 0) * DRIFT) % TILE;
    return { transform: [{ translateY: -travel }] };
  });

  return (
    <View
      // The ground under everything it draws: an SVG re-measures a frame
      // or two behind its own view, and on a rotation that gap showed as
      // white patches until whatever is behind this was painted.
      style={[StyleSheet.absoluteFill, styles.frame, { backgroundColor: theme.ground }]}
      pointerEvents="none"
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setOwn((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }}
    >
      {/* A custom IMAGE replaces the whole rest of this view - still, no
          drift, blurred by the OS's own native blurRadius rather than a
          BlurView (nothing to composite it over here, and blurRadius on
          a plain Image is the same trick a note's own cover could use if
          it ever wanted one). Falls back to the flat ground colour above
          while it is still downloading from Drive on a fresh device. */}
      {override?.type === 'image' && imageStatus === 'ready' && (
        <Image
          source={{ uri: override.uri }}
          blurRadius={Math.round((override.blur / 100) * 30)}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
      )}
      {!(override?.type === 'image') && (
        <>
      {/* The gradient stays where it is: it is the screen's own colour,
          top to bottom, and it must not slide with the clouds. 1px bled
          past every edge - the window size can round to a hair less than
          the real screen, leaving a sliver of white. */}
      <Svg width={width + 2} height={height + 2} style={styles.bleed} pointerEvents="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            {/* Evenly spaced, however many stops there are - the built-in
                theme washes keep their old 0.03/0.52/1 spacing (a slight
                lean toward the top) by being three exactly; a custom
                gradient of 2-4 stops spaces itself out plainly instead,
                since there is no "middle" to lean toward for an even
                count. */}
            {ramp.length === 3
              ? [
                  <Stop key={0} offset="0.03" stopColor={ramp[0]} />,
                  <Stop key={1} offset="0.52" stopColor={ramp[1]} />,
                  <Stop key={2} offset="1" stopColor={ramp[2]} />,
                ]
              : ramp.map((c, i) => (
                  <Stop key={i} offset={ramp.length > 1 ? i / (ramp.length - 1) : 0} stopColor={c} />
                ))}
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

      {/* "для градієнту поверх нього потрібен блюр з регулюванням сили
          повзунком" - a frosted wash over the custom gradient only (the
          built-in theme washes stay crisp, nobody asked for those to
          soften). No `blurTarget` here on purpose: this is the very
          bottom layer of the screen, not a floating thing reaching for
          content behind it, so there is nothing to hand it a target for
          - on Android that means expo-blur's own honest fallback, a
          plain translucent wash rather than a true blur; iOS blurs the
          gradient for real. */}
      {override?.type === 'gradient' && override.blur > 0 && (
        <BlurView
          intensity={Math.round((override.blur / 100) * 100)}
          tint="dark"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
        </>
      )}
    </View>
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
