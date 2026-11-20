import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';
import type { SharedValue } from 'react-native-reanimated';
import { SOFT_SEMIBOLD } from '../../utils/fonts';
import { onListMoved } from '../../utils/motionHold';
import type { CloudLook, CloudPlace } from './ThemeClouds';
import { deg } from '../../utils/angle';

// THE THEMES AS BALLOONS (2026-10-15, the user's, «поприколу»: «домалюй думкам (кулям) знизу трикутник і нитку, щоб
// було схоже на надувну кульку, і нехай кожного разу вони вилітають з-за меж нижньої частини папки думки.
// Інерційність продумай сам»). Each time the folder comes into view the balloons float up from below its lower edge,
// one after another, and settle where they belong.
// THE INERTIA, thought through: a balloon is light and pulled up, not thrown - so it rises at a slowing, even pace,
// with no spring. Its string trails below it, bent by the climb, and straightens as it slows. At the top it lifts a
// hair past its place and sinks back over most of a second (air, not a bounce), then breathes: a slow bob of a few
// points and a tilt of two degrees about its knot, each balloon at its own pace. Nothing swings wide - the user
// called a bigger sway «нереалістична і гіперболізована».
const STRING = 30;
const KNOT = 7;

const AnimatedPath = Animated.createAnimatedComponent(Path);

export default function ThoughtBalloon({
  place,
  look,
  label,
  beat,
  faded,
  launch,
  from,
  index,
  nudge,
}: {
  place: CloudPlace;
  look: CloudLook;
  label: string;
  // Which balloon in the bunch: its turn to rise, and its own pace.
  beat: number;
  faded?: boolean;
  // Raised each time the folder comes into view - the balloons fly in again.
  launch: number;
  // How far below its place the folder's lower edge is: where it starts from.
  from: number;
  // Where it is pushed from its place right now and how fast - the folder's own little physics (ThoughtsFolder):
  // knocked by a desk swipe into the wall and the others, then settling back.
  index?: number;
  nudge?: SharedValue<{ x: number; y: number; vx: number; vy: number }[]>;
}) {
  const d = place.d;
  const h = Math.round(d * 1.1);
  const rise = useSharedValue(0); // 0 = below the edge, 1 = in place
  const lift = useSharedValue(0); // the small float past the place and back
  const bob = useSharedValue(0); // -1..1, the breathing
  useEffect(() => {
    cancelAnimation(rise);
    cancelAnimation(bob);
    rise.value = 0;
    lift.value = 0;
    bob.value = 0;
    // Not launched yet: it waits below the edge, unseen. (It used to rise at once on mounting AND again when the
    // launch came a moment later - the «два рази гальмування» the user saw on every opening of the app, 2026-10-15.)
    if (launch === 0) return;
    const delay = 120 + beat * 170;
    const climb = 1500 + (beat % 3) * 180;
    rise.value = withDelay(delay, withTiming(1, { duration: climb, easing: Easing.bezier(0.25, 0.55, 0.3, 1) }));
    lift.value = withDelay(
      delay + climb * 0.7,
      withSequence(withTiming(1, { duration: 420, easing: Easing.out(Easing.sin) }), withTiming(0, { duration: 900, easing: Easing.inOut(Easing.sin) }))
    );
    // The breathing, one smooth back-and-forth for ever: down to -1 once, then -1 <-> 1 reversing. (A repeat that
    // starts its sequence over jumped back to its first value every round - the string and the balloon «перестрибує»
    // at each end, 2026-10-15.)
    const pace = 3400 + (beat % 4) * 450;
    bob.value = withDelay(
      delay + climb + 300,
      withSequence(
        withTiming(-1, { duration: pace / 2, easing: Easing.out(Easing.sin) }),
        // A few breaths, not for ever (2026-10-16): a forever animation kept the whole desk redrawing 60 times a
        // second at rest, and the scroll had to share every frame with it. Ends at 0 - resting, level.
        withRepeat(withTiming(1, { duration: pace, easing: Easing.inOut(Easing.sin) }), 5, true),
        withTiming(0, { duration: pace / 2, easing: Easing.inOut(Easing.sin) })
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch]);
  // The first scroll stills it: the breathing settles at once instead of sharing the scroll's frames.
  useEffect(
    () =>
      onListMoved(() => {
        cancelAnimation(bob);
        cancelAnimation(lift);
        bob.value = 0;
        lift.value = 0;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const side = beat % 2 ? 1 : -1;
  const body = useAnimatedStyle(() => {
    const n = nudge && index !== undefined ? nudge.value[index] : undefined;
    // Pushed sideways, it leans away from the way it moves (the string drags behind), at most 9 degrees.
    const lean = n ? Math.max(-9, Math.min(9, -n.vx * 0.025)) : 0;
    return {
      opacity: Math.min(1, rise.value * 3) * (faded ? 0.75 : 1),
      transform: [
        { translateX: n ? n.x : 0 },
        { translateY: (1 - rise.value) * from - lift.value * 4 + bob.value * 2.5 + (n ? n.y : 0) },
        // Leaning a little as it climbs (the air pushing the top back), upright as it arrives; then the slow tilt.
        { rotate: deg(side * (1 - rise.value) * 5 + bob.value * 2 * side + lean) },
      ],
    };
  });
  // The string: hanging from the knot, its lower end trailing to one side while the balloon climbs and swaying
  // against the tilt after.
  const string = useAnimatedProps(() => {
    const n = nudge && index !== undefined ? nudge.value[index] : undefined;
    const trail = side * ((1 - rise.value) * 9 - bob.value * 3) + (n ? Math.max(-12, Math.min(12, -n.vx * 0.03)) : 0);
    const cx = d / 2;
    return { d: `M ${cx} 0 C ${cx + trail * 0.4} ${STRING * 0.35}, ${cx - trail * 0.6} ${STRING * 0.65}, ${cx + trail} ${STRING}` };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        { left: place.x - d / 2, top: place.y - h / 2, width: d, height: h + KNOT + STRING, transformOrigin: [d / 2, h + KNOT, 0] },
        body,
      ]}
    >
      <View
        style={[
          styles.body,
          {
            width: d,
            height: h,
            borderTopLeftRadius: d / 2,
            borderTopRightRadius: d / 2,
            borderBottomLeftRadius: d / 2.2,
            borderBottomRightRadius: d / 2.2,
            backgroundColor: look.to,
            experimental_backgroundImage: `radial-gradient(circle at 38% 30%, ${look.from}, ${look.to})`,
          },
        ]}
      >
        {/* The shine a balloon has. */}
        <View style={[styles.shine, { left: d * 0.2, top: h * 0.14, width: d * 0.16, height: h * 0.22, borderRadius: d * 0.1 }]} />
        <Text
          style={[styles.label, { color: look.ink }]}
          numberOfLines={/\s/.test(label.trim()) ? 2 : 1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          textBreakStrategy="simple"
        >
          {label}
        </Text>
      </View>
      <Svg width={d} height={KNOT + STRING} style={{ marginTop: -1 }}>
        {/* The knot: a small triangle, point up, tied under the balloon. */}
        <Path d={`M ${d / 2} 0 L ${d / 2 - 4.5} ${KNOT} L ${d / 2 + 4.5} ${KNOT} Z`} fill={look.to} />
        <G transform={`translate(0 ${KNOT})`}>
          <AnimatedPath animatedProps={string} stroke={look.sub} strokeOpacity={0.55} strokeWidth={1.2} fill="none" strokeLinecap="round" />
        </G>
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', alignItems: 'center' },
  body: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  shine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.45)', transform: [{ rotate: '-20deg' }] },
  label: { fontSize: 12, fontFamily: SOFT_SEMIBOLD, textAlign: 'center' },
});
