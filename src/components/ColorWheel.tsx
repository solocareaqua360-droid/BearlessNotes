import { useRef } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { hslToHex } from '../utils/color';

// The hue ring, on its own so the two things that need one can share
// it: the gradient picker (ColorSchemeSheet) and the interface scheme
// (InterfaceSchemeSheet). Dragging anywhere on it turns the WHOLE
// scheme - the angle under the finger becomes the base hue and every
// other dot keeps its offset from it. That is what a wheel is for: the
// relationships hold while the set rotates.

const RING_THICKNESS = 26;
// One wedge every 5 degrees: fine enough that the ring reads as a
// continuous spectrum, coarse enough that it is 72 paths and not 360.
const WEDGE = 5;

function ring(size: number) {
  const outer = size / 2;
  const inner = size / 2 - RING_THICKNESS;
  const c = size / 2;
  const toXY = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [c + r * Math.cos(rad), c + r * Math.sin(rad)];
  };
  return Array.from({ length: 360 / WEDGE }, (_, i) => {
    const [x1, y1] = toXY(i * WEDGE, outer);
    const [x2, y2] = toXY((i + 1) * WEDGE + 0.5, outer);
    const [x3, y3] = toXY((i + 1) * WEDGE + 0.5, inner);
    const [x4, y4] = toXY(i * WEDGE, inner);
    return {
      d: `M ${x1} ${y1} A ${outer} ${outer} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 0 0 ${x4} ${y4} Z`,
      fill: hslToHex(i * WEDGE, 85, 55),
    };
  });
}

// Built once per size, not per render - 72 paths is cheap to draw and
// needlessly expensive to recompute on every frame of a drag.
const RINGS = new Map<number, ReturnType<typeof ring>>();
function ringFor(size: number) {
  let r = RINGS.get(size);
  if (!r) {
    r = ring(size);
    RINGS.set(size, r);
  }
  return r;
}

export type WheelDot = { hue: number; color: string; active?: boolean };

export default function ColorWheel({
  size = 220,
  dots,
  onHue,
}: {
  size?: number;
  dots: WheelDot[];
  onHue: (hue: number) => void;
}) {
  // Through a ref, for the same reason GradientSlider reads its width
  // that way: PanResponder is built once and a handler that closed
  // over the first render's callback would call a stale one forever.
  const handler = useRef(onHue);
  handler.current = onHue;
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => pick(e.nativeEvent.locationX, e.nativeEvent.locationY),
      onPanResponderMove: (e) => pick(e.nativeEvent.locationX, e.nativeEvent.locationY),
    })
  ).current;

  const sizeRef = useRef(size);
  sizeRef.current = size;
  function pick(x: number, y: number) {
    const c = sizeRef.current / 2;
    const deg = (Math.atan2(y - c, x - c) * 180) / Math.PI + 90;
    handler.current(Math.round(((deg % 360) + 360) % 360));
  }

  const dotAt = (hue: number) => {
    const c = size / 2;
    const r = size / 2 - RING_THICKNESS / 2;
    const rad = ((hue - 90) * Math.PI) / 180;
    return { x: c + r * Math.cos(rad), y: c + r * Math.sin(rad) };
  };

  return (
    <View style={{ width: size, height: size }} {...responder.panHandlers}>
      <Svg width={size} height={size}>
        {ringFor(size).map((w, i) => (
          <Path key={i} d={w.d} fill={w.fill} />
        ))}
        {dots.map((dot, i) => {
          const p = dotAt(dot.hue);
          return (
            <Circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={dot.active ? 11 : 8}
              fill={dot.color}
              stroke={dot.active ? '#fff' : 'rgba(0,0,0,0.45)'}
              strokeWidth={dot.active ? 3 : 1.5}
            />
          );
        })}
      </Svg>
    </View>
  );
}
