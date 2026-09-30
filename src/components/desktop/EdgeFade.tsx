import { View } from 'react-native';
import { useDeskColors } from '../../theme/desktopTheme';
import { withAlpha } from '../../utils/color';

// WHAT RUNS OFF THE BOTTOM of a window melts into it instead of being cut
// by the edge (the way Craft does, 2026-10-01: "блюр виходу за екран"): a
// band at the foot of a scrolling area that blurs what is under it more and
// more towards the edge and washes it into the ground. The laptop's only -
// it is CSS (backdrop-filter, mask-image) and draws nothing to touch.
export default function EdgeFade({ height = 88, color }: { height?: number; color?: string }) {
  const D = useDeskColors();
  const ground = color ?? D.ground;
  return (
    <View
      pointerEvents="none"
      style={
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height,
          zIndex: 5,
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          // The blur grows towards the edge: none at the top of the band.
          maskImage: 'linear-gradient(to bottom, transparent, black 55%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 55%)',
          backgroundImage: `linear-gradient(to bottom, ${withAlpha(ground, 0)}, ${withAlpha(ground, 0.45)} 50%, ${withAlpha(ground, 0.95)})`,
        } as never
      }
    />
  );
}
