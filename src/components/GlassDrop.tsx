import { useId, useState } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { useBlurTarget, useInsideBlurTarget } from './GlassTarget';
import type { Lift } from '../theme/tokens';

// A drop of liquid glass, in whatever shape it is asked for.
//
// Not a button: a SURFACE. The round buttons, the two- and three-button
// capsules on the rail, the navigation island and the search pill are all
// the same thing at different sizes - the user was explicit that the
// capsules take the gloss too, not only the round buttons.
//
// The FIRST version of this was a translucent fill, one uniform white
// hairline and a box shadow, and the user's verdict was right: on white
// it was only tolerable because the ground was white, and on black it
// looked bad. Uniform edges are why. Real glass is lit from somewhere,
// so what is drawn here is lit from somewhere:
//
//   1. the body - translucent, blurred, the screen still visible through
//      it, lighter at the top than at the foot;
//   2. an OUTER specular that follows the contour and is strongest at
//      the TOP-LEFT, fading to nothing by the opposite corner - a
//      gradient along a stroked outline, never a border;
//   3. an INNER rim a little way inside the edge, strongest at the
//      BOTTOM-RIGHT, which is what gives the glass thickness;
//   4. an inner vignette that reaches INTO the glass from the rim, drawn
//      as several strokes of falling opacity because that is how you get
//      a soft edge without a blur filter - so the edge reads optically
//      thicker than the middle, and the middle stays clean.
//
// Skia would do this in fewer layers and the brief asked for it, but it
// is not in this project and cannot be: a new native module changes the
// runtime fingerprint, and the phone would stop receiving updates until
// it was given a new APK. react-native-svg is already here and does all
// four - the brief's own instruction was not to add a graphics library
// if the project already has one.
//
// The structure is two views on purpose: Android clips a child's shadow
// to a parent with `overflow: 'hidden'`, and the glass needs exactly that
// clipping to keep its radius - so the OUTER view carries the lift and
// does not clip, and an inner one carries the glass and does.
export default function GlassDrop({
  children,
  style,
  radius = 999,
  // Every visual parameter is the theme's by default and the caller's
  // when it has a reason - see tokens.ts for what each one is.
  glassOpacity,
  blurAmount,
  specularIntensity,
  rimOpacity,
  vignetteIntensity,
  // Overrides the theme's own answer, for a surface that must not lift at
  // all (one already sitting on another piece of glass).
  lift,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  glassOpacity?: number;
  blurAmount?: number;
  specularIntensity?: number;
  rimOpacity?: number;
  vignetteIntensity?: number;
  lift?: Lift | 'none';
}) {
  const theme = useTheme();
  const blurTarget = useBlurTarget();
  // A drop standing inside the blur target must not blur: on Android a
  // blur inside the view it blurs recurses natively and kills the app
  // outright - no red screen, nothing an error boundary can catch. That
  // was the diary. Such a drop keeps every other layer and simply has no
  // blur; a screen that wants the blur draws the drop through GlassPortal.
  const insideTarget = useInsideBlurTarget();
  const how = lift ?? theme.lift;
  const g = theme.glass;
  // Unique per instance: in the browser every <Svg> shares one document,
  // so fixed ids would have the first drop on screen colouring them all.
  const uid = useId();
  // Strokes are drawn in real coordinates - a percentage cannot be inset
  // by half a stroke width - so the drop measures itself. One extra
  // render on mount, and nothing flashes: the glass simply arrives with
  // the blur that is already under it.
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const w = box?.width ?? 0;
  const h = box?.height ?? 0;
  // A capsule asks for 999; what it actually means is "half of me".
  const r = Math.min(radius, Math.min(w, h) / 2);
  const specular = specularIntensity ?? g.specularIntensity;
  const rim = rimOpacity ?? g.rimOpacity;
  const vignette = vignetteIntensity ?? g.vignetteIntensity;

  return (
    <View
      style={[{ borderRadius: radius }, liftStyle(how, theme.glow), style]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
      }}
    >
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]} pointerEvents="none">
        {!insideTarget && (
          <BlurView
            intensity={blurAmount ?? g.blur}
            tint={g.blurTint}
            blurMethod="dimezisBlurView"
            blurTarget={blurTarget ?? undefined}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        )}
        {w > 0 && h > 0 && (
          <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              {/* The body. Lighter where the light comes from, so even the
                  clean middle is not a flat wash of one colour. */}
              <LinearGradient id={`${uid}-body`} x1="0" y1="0" x2="0.35" y2="1">
                <Stop offset="0" stopColor={g.body} stopOpacity={(glassOpacity ?? g.opacity) * 1.15} />
                <Stop offset="1" stopColor={g.body} stopOpacity={(glassOpacity ?? g.opacity) * 0.85} />
              </LinearGradient>
              {/* The outer specular: brightest at the top-left corner and
                  gone by the middle of the run, which is what stops it
                  reading as a border. */}
              <LinearGradient id={`${uid}-spec`} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={g.specular} stopOpacity={specular} />
                <Stop offset="0.35" stopColor={g.specular} stopOpacity={specular * 0.35} />
                <Stop offset="0.7" stopColor={g.specular} stopOpacity={0} />
              </LinearGradient>
              {/* The inner rim, the other way round: the far edge of a
                  thick transparent thing catches the light that went
                  through it. */}
              <LinearGradient id={`${uid}-rim`} x1="1" y1="1" x2="0.2" y2="0.1">
                <Stop offset="0" stopColor={g.rim} stopOpacity={rim} />
                <Stop offset="0.45" stopColor={g.rim} stopOpacity={rim * 0.4} />
                <Stop offset="1" stopColor={g.rim} stopOpacity={0} />
              </LinearGradient>
            </Defs>

            <Rect x={0} y={0} width={w} height={h} rx={r} fill={`url(#${uid}-body)`} />

            {/* The vignette, reaching inwards. Four strokes of falling
                opacity rather than one blurred edge: react-native-svg's
                filters are not to be relied on across both platforms, and
                four cheap rings are indistinguishable from a soft one at
                this size. */}
            {VIGNETTE_RINGS.map((ring, index) => (
              <Rect
                key={index}
                x={ring.inset}
                y={ring.inset}
                width={Math.max(0, w - ring.inset * 2)}
                height={Math.max(0, h - ring.inset * 2)}
                rx={Math.max(0, r - ring.inset)}
                fill="none"
                stroke={g.vignette}
                strokeOpacity={vignette * ring.opacity}
                strokeWidth={ring.width}
              />
            ))}

            {/* The rim, a little way in - the thickness of the glass. */}
            <Rect
              x={2.5}
              y={2.5}
              width={Math.max(0, w - 5)}
              height={Math.max(0, h - 5)}
              rx={Math.max(0, r - 2.5)}
              fill="none"
              stroke={`url(#${uid}-rim)`}
              strokeWidth={1.2}
            />

            {/* The outer contour, last, so the brightest thing on the
                drop is its lit edge. */}
            <Rect
              x={0.6}
              y={0.6}
              width={Math.max(0, w - 1.2)}
              height={Math.max(0, h - 1.2)}
              rx={Math.max(0, r - 0.6)}
              fill="none"
              stroke={`url(#${uid}-spec)`}
              strokeWidth={1.2}
            />
          </Svg>
        )}
      </View>
      {children}
    </View>
  );
}

// Inset, width and strength of each ring of the inner vignette. Tight and
// strong at the edge, wide and faint as it reaches the middle.
const VIGNETTE_RINGS = [
  { inset: 0.5, width: 1, opacity: 1 },
  { inset: 2, width: 2, opacity: 0.55 },
  { inset: 4.5, width: 3, opacity: 0.28 },
  { inset: 8, width: 4, opacity: 0.12 },
];

// How the drop parts from its ground.
//
// 'glow' is two shadows, never one: a tight bright one right at the shape
// - the source's own edge - and a wide soft one offset DOWN, where the
// light lands. An even halo all round reads as "something blurred and
// unclear" rather than as light; giving the blur a direction is what
// makes the eye call it light. The user's own observation, and it is how
// light actually behaves.
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
      shadowOpacity: 0.18,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
    };
  }
  // 'blur' (the colour theme) and 'none': the glass itself is what parts
  // it from the screen, and a shadow under it only muddies the blur.
  return {};
}

// An icon standing ON a drop of glass.
//
// Every control in this app is one of a few KINDS, and this is the one
// that kept going wrong: the icons inside the capsules each named their
// own colour - "#fff", written when the app had one dark theme - so half
// of them turned black and half stayed white the moment a second theme
// existed. A control on glass does not get to choose; it asks. Use this
// anywhere an icon sits on a GlassDrop, and `tone="muted"` for the ones
// that are deliberately quieter.
//
// Icons that are NOT on glass keep their own colour on purpose: white on
// a photograph's scrim, or the ink of the card they sit on. See
// scripts/audit-controls.sh for where each kind lives.
export function GlassIcon({
  name,
  size = 24,
  tone = 'primary',
  style,
}: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  size?: number;
  tone?: 'primary' | 'muted' | 'faint';
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  const colour =
    tone === 'primary' ? theme.glass.ink : tone === 'muted' ? theme.glass.inkMuted : theme.ink.faint;
  return <Ionicons name={name} size={size} color={colour} style={style} />;
}
