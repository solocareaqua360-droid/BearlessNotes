import { View } from 'react-native';
import { useDeskColors } from '../../theme/desktopTheme';
import { withAlpha } from '../../utils/color';

// WHAT RUNS OFF THE BOTTOM of a window melts into it instead of being cut
// by the edge (the way Craft does, 2026-10-01: "блюр виходу за екран"). The
// laptop's only - it is CSS - and it draws nothing to touch.
//
// A PROGRESSIVE blur, and that is the whole point. The first version was one
// blur of one strength with a mask over its top: the mask only faded how
// much of the blurred copy showed, so a line appeared where the blur began
// and the text read doubled across the band ("різкий перехід ... я тобі про
// це вже казав"). Here the STRENGTH grows: a stack of layers, each blurring
// twice as much as the one above it and each shown only over its own slice
// of the band, overlapping its neighbours - so from the top of the band to
// the edge the blur climbs from nothing to its full strength with no step.
// The wash into the ground follows an eased curve, not a straight line, for
// the same reason.
const LAYERS = [0.5, 1, 2, 4, 8, 16];

// Eased (smoothstep) stops for the wash, so it starts imperceptibly and
// arrives softly instead of in a straight ramp that shows its own start.
function washStops(ground: string, top: number): string {
  const steps = 8;
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const eased = t * t * (3 - 2 * t);
    parts.push(`${withAlpha(ground, eased * top)} ${Math.round(t * 100)}%`);
  }
  return parts.join(', ');
}

export default function EdgeFade({ height = 120, color }: { height?: number; color?: string }) {
  const D = useDeskColors();
  const ground = color ?? D.ground;
  const n = LAYERS.length;
  // Each layer's slice: it rises over one step, holds over the next, and
  // gives way over the one after - the neighbours overlap it on both sides.
  const step = 100 / (n + 1);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height, zIndex: 5 }}>
      {LAYERS.map((blur, i) => {
        const a = i * step;
        const b = (i + 1) * step;
        const c = (i + 2) * step;
        const d = (i + 3) * step;
        const last = i === n - 1;
        const mask = last
          ? `linear-gradient(to bottom, transparent ${a}%, black ${b}%, black 100%)`
          : `linear-gradient(to bottom, transparent ${a}%, black ${b}%, black ${c}%, transparent ${d}%)`;
        return (
          <View
            key={blur}
            style={
              {
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                backdropFilter: `blur(${blur}px)`,
                WebkitBackdropFilter: `blur(${blur}px)`,
                maskImage: mask,
                WebkitMaskImage: mask,
              } as never
            }
          />
        );
      })}
      <View
        style={
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            backgroundImage: `linear-gradient(to bottom, ${washStops(ground, 0.92)})`,
          } as never
        }
      />
    </View>
  );
}
