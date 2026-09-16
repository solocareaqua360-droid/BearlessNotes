import { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { useBlurTarget } from './GlassTarget';
import type { Lift } from '../theme/tokens';

// A drop of glass, in whatever shape it is asked for.
//
// Not a button: a SURFACE. The round buttons, the two- and three-button
// capsules on the rail, the navigation island and the search pill are all
// the same thing at different sizes, and the user was explicit that the
// capsules take the gloss too - so this takes a size and a radius from
// whoever wraps it and draws the same four things at any of them:
//
//   the blur, the theme's tint over it, a specular laid top-left, and
//   two edges - light where the light catches, dark where it turns away.
//
// It matters most where there is least: a white or black theme with no
// gloss is flat however many shadows it has (the user's own words), and
// these drops are what carries those two themes. So `glass` is a role in
// all three (see tokens.ts), not a trick of the colour one.
//
// The structure is two views on purpose. Android clips a child's shadow
// to a parent with `overflow: 'hidden'`, and the blur needs exactly that
// clipping to keep the radius - so the OUTER view carries the lift and
// does not clip, and an inner one carries the glass and does.
export default function GlassDrop({
  children,
  style,
  radius = 999,
  // Overrides the theme's own answer, for the rare surface that must not
  // lift at all (one already sitting on another piece of glass).
  lift,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  lift?: Lift | 'none';
}) {
  const theme = useTheme();
  const blurTarget = useBlurTarget();
  const how = lift ?? theme.lift;
  // Unique per instance: in the browser every <Svg> shares one document,
  // so a fixed id would have the first drop on screen colouring all of
  // them.
  const glossId = `drop-gloss-${useId()}`;

  return (
    <View style={[{ borderRadius: radius }, liftStyle(how, theme.glow), style]}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]} pointerEvents="none">
        <BlurView
          intensity={theme.glass.blur}
          tint={theme.glass.blurTint}
          blurMethod="dimezisBlurView"
          blurTarget={blurTarget ?? undefined}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.glass.tint }]} />
        {/* The specular. Laid top-left and fading to nothing, so the drop
            reads as a rounded thing under a light rather than as a
            rectangle someone tinted. */}
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <RadialGradient id={glossId} cx="28%" cy="0%" r="80%">
              <Stop offset="0" stopColor={theme.glass.gloss} stopOpacity="1" />
              <Stop offset="1" stopColor={theme.glass.gloss} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${glossId})`} />
        </Svg>
      </View>
      {/* The edges, as their own layer: a border on the clipping view
          above would be drawn under the blur it clips. */}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            borderWidth: 1,
            borderTopColor: theme.glass.edgeTop,
            borderBottomColor: theme.glass.edgeBottom,
            borderLeftColor: theme.edge.hairline,
            borderRightColor: theme.edge.hairline,
          },
        ]}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

// How the drop parts from its ground.
//
// 'glow' is two shadows, never one: a tight bright one right at the shape
// - the source's own edge - and a wide soft one offset DOWN, where the
// light lands. An even halo all round reads as "something blurred and
// unclear" rather than as light; giving the blur a direction is what
// makes the eye call it light. The user's own observation, and it is how
// light actually behaves. Written as `boxShadow` because that is the one
// form that takes two of them; RN 0.86 on the new architecture supports
// it, and slice 1's device check is what confirms it on this phone.
function liftStyle(
  how: Lift | 'none',
  glow: { near: string; far: string; nearRadius: number; farRadius: number; drop: number }
): ViewStyle {
  if (how === 'glow') {
    return {
      boxShadow: `0px 0px ${glow.nearRadius * 2}px ${glow.near}, 0px ${glow.drop}px ${glow.farRadius}px ${glow.far}`,
    } as ViewStyle;
  }
  if (how === 'shadow') {
    return {
      shadowColor: '#111827',
      shadowOpacity: 0.16,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    };
  }
  // 'blur' (the colour theme) and 'none': the glass itself is what parts
  // it from the screen, and a shadow under it only muddies the blur.
  return {};
}
