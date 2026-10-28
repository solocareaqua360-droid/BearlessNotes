import { useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { useBlurTarget, useInsideBlurTarget } from './GlassTarget';
import { useFrostPaused } from './frostPause';
import { useTheme } from '../theme/ThemeProvider';
import type { SoftTokens } from '../theme/soft';
import { FEATURES } from '../features';

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
// The light theme's milk: plain white, not the theme's cream (#FDFAF4) - cream over the warm ground read as stale white.
const LIGHT_MILK = '#FFFFFF';
// features.glassRefract: the ring at the edge left without the tint, and the film expo-blur lays over every blur (its alpha is
// tied to `intensity`, radius = intensity / blurReductionFactor) kept faint - the same blur radius comes from the factor.
const RING = 3;
const REFRACT_FILM = 10;
// How strongly expo-blur's own film covers per unit of intensity, by tint (Android's TintStyle).
const FILM_ALPHA: Record<string, number> = { dark: 0.69, light: 0.78, default: 0.44 };

// `coat`: the milk's own strength over the blur, for a window that is mostly words and fields (a bottom sheet) - thicker
// than `dense`, so a card behind cannot show through a label (the user, 2026-10-25: «вже погано вікно відображається»).
// `intensity`: a stronger blur for the same reason - what passes behind a sheet must read as a smear, not as cards (the
// user, 2026-10-25: «зливається текст блюр повинен бути сильнішим фон просвічує»).
export default function DockGlassFill({ soft, paused: still, radius, dense, coat, intensity }: { soft: SoftTokens; paused?: boolean; radius?: number; dense?: boolean; coat?: number; intensity?: number }) {
  const theme = useTheme();
  const g = theme.glass;
  const target = useBlurTarget();
  const inside = useInsideBlurTarget();
  const paused = useFrostPaused();
  // `still`: the owner's own pause - a window riding the keyboard has a live blur only while the keyboard stands (a blur
  // on a surface that moves every frame froze the app once - android_live_blur_moving_surface).
  const blur = !!target && !inside && !paused && !still;
  const uid = useId();
  // The rim is drawn in real coordinates (a stroke cannot be inset by a percentage), so the piece measures itself.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const w = box?.w ?? 0;
  const h = box?.h ?? 0;
  // A piece of the dock is a capsule or a circle (half its short side); a menu or a window says its own corner radius - the
  // rim of a rounded RECTANGLE drawn as a capsule ran round it as an oval (the user, 2026-10-24).
  const r = Math.min(radius ?? Infinity, Math.min(w, h) / 2);
  // Only the capsules refract: a window or a menu (`dense`, `coat`) keeps its coat across, words must read on it.
  const refract = FEATURES.glassRefract && blur && !dense && coat === undefined && intensity === undefined;
  const tint = soft.dark ? 'dark' : g.blurTint;
  const baseIntensity = soft.dark ? BLUR : g.blur;
  const baseCoat = soft.dark ? TINT : g.opacity;
  // The inside keeps the darkness it had: what the old film and coat covered together, the new coat covers over a fainter film.
  const filmOf = (i: number) => ((FILM_ALPHA[tint] ?? 0.44) * i) / 100;
  const covered = 1 - (1 - filmOf(baseIntensity)) * (1 - baseCoat);
  // A bubble is clearer than a slab: the middle keeps a little less coat than the old glass (0.85 of it).
  const refractCoat = Math.min(0.97, 0.85 * (1 - (1 - covered) / (1 - filmOf(REFRACT_FILM))));
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
          intensity={refract ? REFRACT_FILM : intensity ?? baseIntensity}
          // The same radius as before (expo-blur's default factor is 4), from a faint film.
          blurReductionFactor={refract ? (REFRACT_FILM * 4) / baseIntensity : undefined}
          tint={tint}
          blurMethod="dimezisBlurView"
          blurTarget={target ?? undefined}
          style={StyleSheet.absoluteFill}
        />
      )}
      {/* Dark: the drawer's material (the dock's own colour at 55%). Light: the white theme's own milk glass, chosen with it
          in September - a thinner blur and a milk at a third, so what passes under the dock still reads (the user, 2026-10-24:
          «в білому варіанті хотілось би трохи більше прозорості»). */}
      <View
        style={[
          StyleSheet.absoluteFill,
          // Refracting: the coat stops short of the edge, so the ring shows the blur nearly bare (features.glassRefract).
          refract && w > 0 && { top: RING, left: RING, right: RING, bottom: RING, borderRadius: Math.max(0, r - RING) },
          // `dense`: glass with TEXT on it over moving text (the chat's top capsule) - a thicker coat, so the words read.
          soft.dark
            ? { backgroundColor: soft.chrome, opacity: blur ? (refract ? refractCoat : coat ?? (dense ? 0.75 : TINT)) : FLAT }
            : { backgroundColor: LIGHT_MILK, opacity: blur ? (refract ? refractCoat : coat ?? (dense ? 0.72 : g.opacity)) : FLAT },
        ]}
      />
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
            {/* Refracting (features.glassRefract): the body's VOLUME - lighter at the top, a shade deeper at the foot - and an
                iridescent inner rim, the round button's soap-bubble lens (DeskDock's pressLens) said quietly (the user, 2026-10-28:
                «внутрішня частина видається пласкою... ефект мильної бульки... Apple робить переливами»). */}
            {/* A TUBE, not a slab (the user, 2026-10-28, the dock beside the round button's bubble: «у кульки ефект бульбашки, а
                у дока ефект плаского скельця... ми знаємо, як виглядають бульки»): glass curved across its height is brighter at
                its top and bottom edges than in its middle, which stays the clearest. */}
            <LinearGradient id={`${uid}-body`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={soft.dark ? 0.16 : 0.42} />
              <Stop offset="0.2" stopColor="#FFFFFF" stopOpacity={soft.dark ? 0.05 : 0.12} />
              <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0} />
              <Stop offset="0.8" stopColor="#FFFFFF" stopOpacity={soft.dark ? 0.03 : 0.08} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={soft.dark ? 0.12 : 0.3} />
            </LinearGradient>
            {/* The bubble's own rim (DeskDock's pressLens, at its strength): round the very edge. */}
            <LinearGradient id={`${uid}-iri`} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.95} />
              <Stop offset="0.3" stopColor="#B9E2FF" stopOpacity={0.75} />
              <Stop offset="0.55" stopColor="#D9BCFF" stopOpacity={0.6} />
              <Stop offset="0.8" stopColor="#C6FFD9" stopOpacity={0.7} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.9} />
            </LinearGradient>
            {/* A window's reflection near the top-left, as on any bubble. */}
            <RadialGradient id={`${uid}-glint`} cx="0.5" cy="0.5" rx="0.5" ry="0.5">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={soft.dark ? 0.22 : 0.55} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </RadialGradient>
            <LinearGradient id={`${uid}-rim`} x1="0" y1="1" x2="0" y2="0">
              <Stop offset="0" stopColor={g.rim} stopOpacity={g.rimOpacity} />
              <Stop offset="0.45" stopColor={g.rim} stopOpacity={g.rimOpacity * 0.4} />
              <Stop offset="1" stopColor={g.rim} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {/* Dark only: on white a dark edge reads as dirt, not as the thickness of the glass - white glass is LIGHTER at its
              edge than in its middle (the user, 2026-10-24: «в білому виглядає бруднувато»). */}
          {soft.dark && !refract && RINGS.map((ring, i) => (
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
          {refract && <Rect x={0} y={0} width={w} height={h} rx={r} fill={`url(#${uid}-body)`} />}
          {refract && <Ellipse cx={Math.min(r * 0.9, w * 0.2)} cy={h * 0.24} rx={Math.min(r * 0.7, w * 0.16)} ry={h * 0.14} fill={`url(#${uid}-glint)`} />}
          {refract && (
            <Rect x={RING + 0.5} y={RING + 0.5} width={Math.max(0, w - RING * 2 - 1)} height={Math.max(0, h - RING * 2 - 1)} rx={Math.max(0, r - RING - 0.5)} fill="none" stroke="#FFFFFF" strokeOpacity={soft.dark ? 0.18 : 0.5} strokeWidth={1} />
          )}
          {refract ? (
            <Rect x={0.8} y={0.8} width={Math.max(0, w - 1.6)} height={Math.max(0, h - 1.6)} rx={Math.max(0, r - 0.8)} fill="none" stroke={`url(#${uid}-iri)`} strokeOpacity={soft.dark ? 0.7 : 0.85} strokeWidth={1.6} />
          ) : (
            <Rect x={2.5} y={2.5} width={Math.max(0, w - 5)} height={Math.max(0, h - 5)} rx={Math.max(0, r - 2.5)} fill="none" stroke={`url(#${uid}-rim)`} strokeOpacity={soft.dark ? 1 : 0.7} strokeWidth={1.2} />
          )}
          {!refract && <Rect x={0.6} y={0.6} width={Math.max(0, w - 1.2)} height={Math.max(0, h - 1.2)} rx={Math.max(0, r - 0.6)} fill="none" stroke={`url(#${uid}-spec)`} strokeWidth={1.2} />}
        </Svg>
      )}
    </View>
  );
}

// The vignette reaching in from the edge: TEN rings of a pixel, each a little fainter (a smooth curve), not GlassDrop's four
// wide ones - on the light theme those four read as separate stripes round the dock, steps where there should be a fade
// (the user, 2026-10-24: «ореоли по контуру ідуть двома явно видимими смужками… сходинки замість плавності»). The same
// amount of shade in all, spread evenly.
const RINGS = Array.from({ length: 10 }, (_, i) => ({ inset: 0.5 + i, width: 1.2, opacity: 0.85 * Math.pow(1 - i / 10, 2.2) }));

// The piece's own style while the glass is on: no fill of its own (the glass is), clipped to its shape, and
// the theme's own light round it - the black theme's glow (two shadows: a tight bright one at the edge, a wide soft one
// thrown down), the white one's shadow. Off, the soft capsule as it always was.
// `capsule`: the dock's and the bar's capsules - refracting (features.glassRefract), they throw no glow; windows and menus keep it.
export function useDockSurface(soft: SoftTokens, glass: boolean, capsule = false) {
  const theme = useTheme();
  if (!glass) return { backgroundColor: soft.chrome, boxShadow: soft.shadow };
  // Refracting glass throws no light round itself (the user, 2026-10-28: «відмовитись від світіння навколо капсули»).
  // Not a glow but the capsule's shadow ON what it lies over, the round button's lens's own (DeskDock) - Apple's glass does the
  // same: it rests on the page.
  if (FEATURES.glassRefract && capsule)
    return { backgroundColor: 'transparent', overflow: 'hidden' as const, boxShadow: soft.dark ? '0px 10px 26px rgba(0,0,0,0.45)' : '0px 10px 24px rgba(0,0,0,0.12)' };
  const g = theme.glow;
  const light =
    soft.dark && theme.lift === 'glow'
      ? `0px 0px ${g.nearRadius * 2}px ${g.near}, 0px ${g.drop}px ${g.farRadius}px ${g.far}`
      : '0px 6px 18px rgba(0,0,0,0.08)';
  return { backgroundColor: 'transparent', overflow: 'hidden' as const, boxShadow: light };
}

// The icons on the glass dock in the light theme: a soft grey rather than near-black (the user, 2026-10-24: «колір іконок
// зробити менш чорним, більш сірим, тільки для білого»). Dark, or the glass off: the soft ink as it was.
export const LIGHT_GLASS_INK = '#5C5B57';
export function dockInk(soft: SoftTokens, glass: boolean): string {
  return glass && !soft.dark ? LIGHT_GLASS_INK : soft.ink;
}
