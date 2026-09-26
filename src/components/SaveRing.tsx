import { useEffect, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';

// The save indicator, drawn on the capsule's own outline instead of
// standing next to it as a button. While a save is in flight a short
// bright arc travels round the contour; when it lands, the whole outline
// lights once and fades. At rest nothing is drawn at all - which is the
// point: an indicator that says "nothing to report" by taking no room.
const STROKE = 2;
// How much of the contour the travelling arc covers.
const ARC = 0.22;

const AnimatedRect = Animated.createAnimatedComponent(Rect);

export default function SaveRing({ saving, color = '#fff' }: { saving: boolean; color?: string }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Where the arc is, 0..1 round the contour.
  const travel = useSharedValue(0);
  const arcOpacity = useSharedValue(0);
  const ringOpacity = useSharedValue(0);

  // A stadium's radius comes from its SHORT side, whichever that is: the
  // capsule stands on its end against the right edge and lies down in the
  // top-left corner, and taking the width both times drew an ellipse far
  // wider than the button it was meant to trace.
  const short = Math.min(size.w, size.h);
  const long = Math.max(size.w, size.h);
  const radius = short / 2 - STROKE / 2;
  // Two straight sides and two half-circle ends.
  const perimeter = Math.max(1, 2 * (long - short) + 2 * Math.PI * radius);

  useEffect(() => {
    if (saving) {
      ringOpacity.value = withTiming(0, { duration: 120 });
      arcOpacity.value = withTiming(1, { duration: 160 });
      travel.value = 0;
      travel.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.linear }), -1, false);
      return;
    }
    cancelAnimation(travel);
    arcOpacity.value = withTiming(0, { duration: 200 });
    // The whole outline, once, then gone.
    ringOpacity.value = withTiming(1, { duration: 180 }, () => {
      ringOpacity.value = withTiming(0, { duration: 900 });
    });
  }, [saving]);

  // Only one animated SVG prop, and it's a plain number - the two
  // opacities ride on wrapper views, where a style animation is certain.
  const dashProps = useAnimatedProps(() => ({
    strokeDashoffset: -travel.value * perimeter,
  }));
  const arcStyle = useAnimatedStyle(() => ({ opacity: arcOpacity.value }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ringOpacity.value }));

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  }

  const rect = {
    x: STROKE / 2,
    y: STROKE / 2,
    width: Math.max(0, size.w - STROKE),
    height: Math.max(0, size.h - STROKE),
    rx: Math.max(0, radius),
    ry: Math.max(0, radius),
    stroke: color,
    strokeWidth: STROKE,
    fill: 'none',
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {size.w > 0 && (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, ringStyle]}>
            <Svg width={size.w} height={size.h}>
              <Rect {...rect} />
            </Svg>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, arcStyle]}>
            <Svg width={size.w} height={size.h}>
              <AnimatedRect
                {...rect}
                strokeLinecap="round"
                strokeDasharray={`${perimeter * ARC},${perimeter * (1 - ARC)}`}
                animatedProps={dashProps}
              />
            </Svg>
          </Animated.View>
        </>
      )}
    </View>
  );
}
