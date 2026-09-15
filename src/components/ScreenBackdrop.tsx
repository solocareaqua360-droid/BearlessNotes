import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

// What every screen stands on, and what the glass has to blur.
//
// It used to be one flat gradient pinned to the window: nothing under the
// rail ever moved, so the glass showed the same three colours forever.
// Now that the lists keep clear of the rail (see RAIL_CLEARANCE) not even
// a card passes behind it - so the backdrop itself has to be the thing
// that moves.
//
// It is taller than the window and drifts up as the list scrolls, at a
// fraction of the list's speed: a parallax. Over the gradient sit three
// wide, soft colour clouds - the blur turns them into the slow
// iridescence that runs through the capsules while you scroll. Their
// colours are the app's own palette, kept low in saturation: the screen
// still reads as the same warm-to-black gradient, it simply is not flat
// any more.
//
// Still react-native-svg, not expo-linear-gradient: that would be a new
// native module and another dev-client build (the same reason the flat
// gradient was drawn this way).
const DRIFT = 0.18;
const OVERSCAN = 1.6;

export default function ScreenBackdrop({
  id,
  colors,
  scrollY,
}: {
  // A gradient's id has to be unique in the document - each screen passes
  // its own, as they did when every screen drew this itself.
  id: string;
  colors: [string, string, string];
  // Absent (a screen with no list of its own) - the backdrop simply
  // stands still, exactly as before.
  scrollY?: SharedValue<number>;
}) {
  const { width, height } = useWindowDimensions();
  const canvasHeight = height * OVERSCAN;

  const style = useAnimatedStyle(() => {
    const y = scrollY?.value ?? 0;
    // Never past its own overscan, however long the list is.
    const travel = Math.min(y * DRIFT, canvasHeight - height);
    return { transform: [{ translateY: -Math.max(0, travel) }] };
  });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.wrap, style]} pointerEvents="none">
      {/* 1px bled past every edge - the window size can round to a hair
          less than the real screen, leaving a sliver of white at an edge. */}
      <Svg width={width + 2} height={canvasHeight + 2} style={styles.svg} pointerEvents="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor={colors[0]} />
            <Stop offset="0.52" stopColor={colors[1]} />
            <Stop offset="1" stopColor={colors[2]} />
          </LinearGradient>
          {/* Three clouds, each its own radial fade to nothing. */}
          <RadialGradient id={`${id}-a`} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#C98A5B" stopOpacity="0.5" />
            <Stop offset="1" stopColor="#C98A5B" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={`${id}-b`} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#7FA3A0" stopOpacity="0.45" />
            <Stop offset="1" stopColor="#7FA3A0" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={`${id}-c`} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#8D7BB0" stopOpacity="0.35" />
            <Stop offset="1" stopColor="#8D7BB0" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width={width + 2} height={canvasHeight + 2} fill={`url(#${id})`} />
        {/* Placed against the rail's own column, since that is where the
            glass stands - the drift is what carries them through it. */}
        <Rect
          x={width * 0.35}
          y={canvasHeight * 0.02}
          width={width * 1.1}
          height={canvasHeight * 0.34}
          fill={`url(#${id}-a)`}
        />
        <Rect
          x={width * 0.1}
          y={canvasHeight * 0.3}
          width={width * 1.2}
          height={canvasHeight * 0.4}
          fill={`url(#${id}-b)`}
        />
        <Rect
          x={width * 0.3}
          y={canvasHeight * 0.62}
          width={width * 1.1}
          height={canvasHeight * 0.36}
          fill={`url(#${id}-c)`}
        />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
  },
  svg: {
    position: 'absolute',
    top: -1,
    left: -1,
  },
});
