import { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useBlurTarget } from './GlassTarget';
import { useTheme } from '../theme/ThemeProvider';

// THE DOCK'S MATERIAL, and now the only copy of it.
//
// It lived inside ContextDock until 2026-09-19, when the editor's "/"
// toolbar turned out to be invisible in the white theme - white ink on a
// pale pill - and the fix for that uncovered a worse one waiting in the
// black theme. That bar wore GlassDrop with `glassOpacity` forced to
// 0.94, and the black theme's glass BODY is #FFFFFF at 5%: raising the
// opacity of a white body makes a white slab. The same trap is already
// written down in the project memory from when the dock itself hit it.
//
// So the answer is not a better number. It is that there should not be a
// second recipe: this is the tags drawer's own construction, layer for
// layer, which is the material the user picked by eye ("у шторки рівень
// блюру і структури матеріалу який ідеально підійде для нашого дока")
// and confirmed on-device. Anything that wants to look like the dock
// uses this and gets it right by construction.
//
// Deliberately NOT GlassDrop: GlassDrop paints its body as an SVG
// rectangle, which at full strength is a solid plate, and two rounds of
// tuning its numbers never matched the drawer.
const FROST_BLUR = 60;
const FROST_TINT = 0.55;

// How solid the fill gets when the live blur is off - see `blur`. High
// enough that the text underneath does not read through it, which is
// the whole reason the editor's bar wanted a dense material in the
// first place.
const FLAT_TINT = 0.97;

export default function DockFrost({
  style,
  radius,
  blur = true,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  // Said explicitly, never `999`. Android works a capped radius out from
  // the size it knows when it first draws the background, and with sizes
  // computed from the window that size is not there on the first frame -
  // the dock's "you are here" disc came up a rounded SQUARE until
  // something happened to redraw it.
  radius: number;
  // OFF for anything that MOVES every frame.
  //
  // `dimezisBlurView` is a real-time blur: it re-captures and re-blurs
  // the view hierarchy beneath it, and a surface that changes position
  // on every frame makes it do that on every frame. The editor's "/"
  // bar is exactly that - it rides the keyboard's own live height, so
  // its `bottom`, `opacity` and `translateY` all move together while
  // the keyboard animates, directly over the text being scrolled and
  // typed. That combination froze the app on a tap into any text field,
  // in a note and in the calendar's daily note alike, until Android
  // killed it: "зависає і потім закривається".
  //
  // A still surface can afford the live blur. A moving one takes the
  // same colour recipe without it, one shade denser - same material,
  // same file, no second recipe to keep in step.
  blur?: boolean;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const blurTarget = useBlurTarget();
  // `surface` is an opaque dark fill in black/white (a real tint the blur
  // can lean on) but a near-transparent WHITE highlight in colour
  // (rgba(255,255,255,0.07), meant to lighten that theme's own dark
  // ground - a different job). Layered here at 55% it added nothing in
  // colour, so the capsule's darkness came ENTIRELY from BlurView's own
  // "dark" tint - which on this device blurred the backdrop's light warm
  // gradient into a LIGHT capsule instead, and the glass ink colours
  // (built for a dark one) vanished into it: "відображення тексту на
  // календарі... не видно в кольоровій темі". `glass.body`/
  // `glass.opacity` is the token actually meant for this - a real dark
  // fill independent of what is behind the blur.
  const tintColor = theme.key === 'colour' ? theme.glass.body : theme.surface;
  // Without the blur underneath it, the fill is the only thing standing
  // between the content and whatever is behind - so it carries the
  // whole job itself.
  const tintOpacity = blur ? (theme.key === 'colour' ? theme.glass.opacity : FROST_TINT) : FLAT_TINT;
  return (
    <View style={[style, { borderRadius: radius, overflow: 'hidden' }]}>
      {blur && (
        <BlurView
          intensity={FROST_BLUR}
          tint="dark"
          blurMethod="dimezisBlurView"
          blurTarget={blurTarget ?? undefined}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: tintColor, opacity: tintOpacity }]}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}
