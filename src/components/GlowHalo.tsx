import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { HALO } from '../constants/rail';

// The light a rail button casts on whatever is under it. A real radial
// falloff (react-native-svg, already a dependency) rather than a stack of
// translucent circles, which reads as rings rather than a glow - and
// rather than a shadow, which Android paints grey whatever colour it is
// told.
let nextId = 0;

export default function GlowHalo({ color, size = HALO }: { color: string; size?: number }) {
  const idRef = useRef<string | null>(null);
  // One gradient id per instance: two <Defs> sharing an id and the second
  // one silently wins for both.
  if (idRef.current === null) idRef.current = `halo${nextId++}`;
  const id = idRef.current;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0.32" stopColor={color} stopOpacity="0.5" />
            <Stop offset="0.62" stopColor={color} stopOpacity="0.18" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
