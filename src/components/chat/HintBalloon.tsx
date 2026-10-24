import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SOFT_SEMIBOLD } from '../../utils/fonts';

// The app's balloon (BalloonMark's shape) filled, with a «?» in it - the dock's way to the hints.
export default function HintBalloon({ color, size = 22 }: { color: string; size?: number }) {
  const h = Math.round(size * (26 / 22));
  return (
    <View style={{ width: size, height: h }}>
      <Svg width={size} height={h} viewBox="0 0 22 26">
        <Path d="M11 2c4 0 7 3 7 7 0 4.4-3.5 8-7 8.8C7.5 17 4 13.4 4 9c0-4 3-7 7-7z" fill={color} />
        <Path d="M10 17.6l1 1.4 1-1.4" fill={color} />
        <Path d="M11 19c-1 1.6 1 2.6 0 4.5" stroke={color} strokeWidth={1.4} fill="none" />
      </Svg>
      <Text style={{ position: 'absolute', left: 0, right: 0, top: size * 0.09, textAlign: 'center', fontSize: size * 0.5, fontFamily: SOFT_SEMIBOLD, color: '#FFFFFF' }}>?</Text>
    </View>
  );
}
