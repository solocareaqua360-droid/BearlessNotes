import Svg, { Path } from 'react-native-svg';

// THE AI'S OWN SIGN (2026-10-23, the user: the four-point star «трішечки схожа на логотип Gemini... хотілося б щось своє»;
// chosen from eight - «кулька»): a balloon on its string, the same thing the «Думки» desk draws its thoughts as - the
// conversation is where a thought goes up. Drawn as lines in one colour, so it sits with the dock's other icons.
export default function BalloonMark({ size = 22, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {/* The balloon, a little narrower at the bottom. */}
      <Path d="M12 3c3.4 0 5.8 2.6 5.8 5.8 0 3.6-2.9 6.6-5.8 7.2-2.9-.6-5.8-3.6-5.8-7.2C6.2 5.6 8.6 3 12 3z" />
      {/* Its knot. */}
      <Path d="M11 16.1l1 1.3 1-1.3" />
      {/* The string, with one soft bend. */}
      <Path d="M12 17.4c-.9 1.3.9 2.1 0 3.6" />
      {/* A glint on the upper left. */}
      <Path d="M9.3 7.3c.4-.9 1.2-1.5 2.2-1.7" />
    </Svg>
  );
}
