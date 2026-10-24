import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useBlurTarget, useInsideBlurTarget } from './GlassTarget';
import { useFrostPaused } from './frostPause';
import { useTheme } from '../theme/ThemeProvider';
import type { SoftTokens } from '../theme/soft';

// THE DOCK'S GLASS (utils/dockGlass): what one piece of the soft dock is made of while the switch is on - the tags
// drawer's material the user picked for the dock in September («у шторки рівень блюру і структури матеріалу який ідеально
// підійде для нашого дока»): a live blur at 60, the dock's own colour over it at 55%, and a hairline of light round the edge.
// Drawn as the piece's FIRST child, filling it; the piece itself turns transparent and clips (dockSurface).
//
// Never inside the blur target (a blur of the view it stands in takes the app down - GlassTarget), and flat while the
// frost is paused (something heavy moving underneath - frostPause), the same as DockFrost.
const BLUR = 60;
const TINT = 0.55;
const FLAT = 0.97;

export default function DockGlassFill({ soft }: { soft: SoftTokens }) {
  const target = useBlurTarget();
  const inside = useInsideBlurTarget();
  const paused = useFrostPaused();
  const blur = !!target && !inside && !paused;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
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
    </View>
  );
}

// The piece's own style while the glass is on: no fill of its own (the glass is), clipped to its shape, a light rim, and
// the theme's own light round it - the black theme's glow (two shadows: a tight bright one at the edge, a wide soft one
// thrown down), the white one's shadow. Off, the soft capsule as it always was.
export function useDockSurface(soft: SoftTokens, glass: boolean) {
  const theme = useTheme();
  if (!glass) return { backgroundColor: soft.chrome, boxShadow: soft.shadow };
  const g = theme.glow;
  const rim = soft.dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.75)';
  const light =
    theme.lift === 'glow'
      ? `0px 0px ${g.nearRadius * 2}px ${g.near}, 0px ${g.drop}px ${g.farRadius}px ${g.far}`
      : '0px 8px 22px rgba(30,30,28,0.14)';
  return { backgroundColor: 'transparent', overflow: 'hidden' as const, borderWidth: StyleSheet.hairlineWidth, borderColor: rim, boxShadow: light };
}
