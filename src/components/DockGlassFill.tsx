import { useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { useBlurTarget, useInsideBlurTarget } from './GlassTarget';
import { useFrostPaused } from './frostPause';
import { useTheme } from '../theme/ThemeProvider';
import type { SoftTokens } from '../theme/soft';

// THE DOCK'S GLASS (utils/dockGlass): what one piece of the soft dock is made of while the switch is on - the tags
// drawer's material the user picked for the dock in September («у шторки рівень блюру і структури матеріалу який ідеально
// підійде для нашого дока»): a live blur at 60, the dock's own colour over it at 55%, and GlassDrop's lit rim.
// Drawn as the piece's FIRST child, filling it; the piece itself turns transparent and clips (dockSurface).
//
// Never inside the blur target (a blur of the view it stands in takes the app down - GlassTarget), and flat while the
// frost is paused (something heavy moving underneath - frostPause), the same as DockFrost.
const BLUR = 60;
const TINT = 0.55;
const FLAT = 0.97;
// The lit edge, as a share of the theme's own specular. And lit from ABOVE, the same along the whole top - not from the
// top-left corner as GlassDrop's round drops: on a long capsule a corner light lit the whole left end and the dock read as
// narrower on the left (the user, 2026-10-24: «док перекошений, тобто менший ліворуч»).
const SPEC = 0.7;

export default function DockGlassFill({ soft }: { soft: SoftTokens }) {
  const theme = useTheme();
  const g = theme.glass;
  const target = useBlurTarget();
  const inside = useInsideBlurTarget();
  const paused = useFrostPaused();
  const blur = !!target && !inside && !paused;
  const uid = useId();
  // The rim is drawn in real coordinates (a stroke cannot be inset by a percentage), so the piece measures itself.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const w = box?.w ?? 0;
  const h = box?.h ?? 0;
  // Every piece of the dock is a capsule or a circle: its radius is half its short side.
  const r = Math.min(w, h) / 2;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox((prev) => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
      }}
    >
      {blur && (
        <BlurView
          intensity={BLUR}
          tint={soft.dark ? 'dark' : 'default'}
          blurMethod="dimezisBlurView"
          blurTarget={target ?? undefined}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: soft.chrome, opacity: blur ? TINT : FLAT }]} />
      {/* THE RIM (the user, 2026-10-24, over a photo of the old rail capsule: «Питання в обідку») - GlassDrop's three layers,
          lit from one side: an outer specular along the top edge, gone by the middle, an inner rim a little way in
          brightest along the bottom (the thickness of the glass), and a soft vignette reaching in from the edge. */}
      {w > 0 && h > 0 && (
        <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={`${uid}-spec`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={g.specular} stopOpacity={g.specularIntensity * SPEC} />
              <Stop offset="0.35" stopColor={g.specular} stopOpacity={g.specularIntensity * SPEC * 0.35} />
              <Stop offset="0.7" stopColor={g.specular} stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id={`${uid}-rim`} x1="0" y1="1" x2="0" y2="0">
              <Stop offset="0" stopColor={g.rim} stopOpacity={g.rimOpacity} />
              <Stop offset="0.45" stopColor={g.rim} stopOpacity={g.rimOpacity * 0.4} />
              <Stop offset="1" stopColor={g.rim} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {RINGS.map((ring, i) => (
            <Rect
              key={i}
              x={ring.inset}
              y={ring.inset}
              width={Math.max(0, w - ring.inset * 2)}
              height={Math.max(0, h - ring.inset * 2)}
              rx={Math.max(0, r - ring.inset)}
              fill="none"
              stroke={g.vignette}
              strokeOpacity={g.vignetteIntensity * ring.opacity}
              strokeWidth={ring.width}
            />
          ))}
          <Rect x={2.5} y={2.5} width={Math.max(0, w - 5)} height={Math.max(0, h - 5)} rx={Math.max(0, r - 2.5)} fill="none" stroke={`url(#${uid}-rim)`} strokeWidth={1.2} />
          <Rect x={0.6} y={0.6} width={Math.max(0, w - 1.2)} height={Math.max(0, h - 1.2)} rx={Math.max(0, r - 0.6)} fill="none" stroke={`url(#${uid}-spec)`} strokeWidth={1.2} />
        </Svg>
      )}
    </View>
  );
}

// GlassDrop's vignette: tight and strong at the edge, wide and faint as it reaches the middle.
const RINGS = [
  { inset: 0.5, width: 1, opacity: 1 },
  { inset: 2, width: 2, opacity: 0.55 },
  { inset: 4.5, width: 3, opacity: 0.28 },
  { inset: 8, width: 4, opacity: 0.12 },
];

// The piece's own style while the glass is on: no fill of its own (the glass is), clipped to its shape, and
// the theme's own light round it - the black theme's glow (two shadows: a tight bright one at the edge, a wide soft one
// thrown down), the white one's shadow. Off, the soft capsule as it always was.
export function useDockSurface(soft: SoftTokens, glass: boolean) {
  const theme = useTheme();
  if (!glass) return { backgroundColor: soft.chrome, boxShadow: soft.shadow };
  const g = theme.glow;
  const light =
    theme.lift === 'glow'
      ? `0px 0px ${g.nearRadius * 2}px ${g.near}, 0px ${g.drop}px ${g.farRadius}px ${g.far}`
      : '0px 8px 22px rgba(30,30,28,0.14)';
  return { backgroundColor: 'transparent', overflow: 'hidden' as const, boxShadow: light };
}
