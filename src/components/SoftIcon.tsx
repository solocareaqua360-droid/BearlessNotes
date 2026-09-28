import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

// The soft style's own icons (see theme/soft). Not Ionicons, and not
// Apple's SF Symbols either - those are licensed for Apple's platforms
// only. What made the old ones read as Android was never one glyph but
// three habits of Material's set, and these break all three:
// - a line as heavy as the text beside it, not one thin weight for all;
// - the shapes Material made famous are gone - the arrow with a shaft
//   for "back" is a chevron, "select" is a rounded square rather than a
//   tick in a ring, "new" is a pencil over a sheet rather than a plus;
// - they are drawn in the text's own ink, and stand free inside their
//   capsule instead of each sitting in a disc of its own.
//
// A small set on purpose: only what the soft screens draw. Anything not
// here keeps its Ionicon until it is needed.
export type SoftIconName =
  | 'back'
  | 'more'
  | 'select'
  | 'search'
  | 'compose'
  | 'plus'
  | 'folder'
  | 'trash'
  | 'doc'
  | 'close'
  | 'forward';

export default function SoftIcon({
  name,
  size = 22,
  color,
  strokeWidth = 2,
}: {
  name: SoftIconName;
  size?: number;
  color: string;
  strokeWidth?: number;
}) {
  const line = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'back' && <Path d="M14.6 5.4L8 12l6.6 6.6" {...line} />}
      {name === 'more' && (
        <>
          <Circle cx={5.5} cy={12} r={1.75} fill={color} />
          <Circle cx={12} cy={12} r={1.75} fill={color} />
          <Circle cx={18.5} cy={12} r={1.75} fill={color} />
        </>
      )}
      {name === 'select' && (
        <>
          <Rect x={4} y={4} width={16} height={16} rx={5} {...line} />
          <Path d="M8.6 12.2l2.4 2.4 4.6-4.9" {...line} />
        </>
      )}
      {name === 'search' && (
        <>
          <Circle cx={10.8} cy={10.8} r={6} {...line} />
          <Path d="M15.4 15.4l4.1 4.1" {...line} />
        </>
      )}
      {name === 'compose' && (
        <>
          <Path d="M11 4.6H8a3.4 3.4 0 0 0-3.4 3.4v8A3.4 3.4 0 0 0 8 19.4h8a3.4 3.4 0 0 0 3.4-3.4v-3" {...line} />
          <Path d="M17.3 3.9a1.9 1.9 0 0 1 2.8 2.8l-6.6 6.6-3.6.8.8-3.6z" {...line} />
        </>
      )}
      {name === 'plus' && <Path d="M12 5.4v13.2M5.4 12h13.2" {...line} />}
      {name === 'folder' && (
        <Path
          d="M3.6 8.2a2.6 2.6 0 0 1 2.6-2.6h3.1c.7 0 1.3.3 1.8.8l.9.9h5.8a2.6 2.6 0 0 1 2.6 2.6v6.4a2.6 2.6 0 0 1-2.6 2.6H6.2a2.6 2.6 0 0 1-2.6-2.6z"
          {...line}
        />
      )}
      {name === 'trash' && (
        <>
          <Path d="M5 7h14" {...line} />
          <Path d="M9.6 7V5.6A1.6 1.6 0 0 1 11.2 4h1.6a1.6 1.6 0 0 1 1.6 1.6V7" {...line} />
          <Path d="M6.6 7l.8 10.9a2.1 2.1 0 0 0 2.1 2h5a2.1 2.1 0 0 0 2.1-2l.8-10.9" {...line} />
        </>
      )}
      {name === 'doc' && (
        <Path d="M7.5 3.5h5.8l5.2 5.2v9.3a2.5 2.5 0 0 1-2.5 2.5h-8.5A2.5 2.5 0 0 1 5 18V6a2.5 2.5 0 0 1 2.5-2.5z" {...line} />
      )}
      {name === 'close' && <Path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...line} />}
      {name === 'forward' && <Path d="M9.4 5.4L16 12l-6.6 6.6" {...line} />}
    </Svg>
  );
}

// The mark a card wears while choosing - the SAME shape as the bar's own
// "select" icon above (a rounded square with a tick), not the ring the
// cards used to wear: "іконки виділення не відповідають іконці в
// стрічці". Chosen, it fills with the accent ("обране" is one of the
// accent's three jobs); not chosen, an outline in the quiet ink.
export function SoftCheck({
  checked,
  size = 22,
  accent,
  outline,
  tickColor,
}: {
  checked: boolean;
  size?: number;
  accent: string;
  outline: string;
  tickColor: string;
}) {
  const radius = Math.round(size * 0.32);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        borderWidth: checked ? 0 : 1.8,
        borderColor: outline,
        backgroundColor: checked ? accent : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked && (
        <Svg width={size * 0.72} height={size * 0.72} viewBox="0 0 24 24">
          <Path d="M6.5 12.6l3.6 3.5L17.6 8.4" stroke={tickColor} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      )}
    </View>
  );
}

// A TASK's box on the page - round, as in the soft mockup's note, and so
// distinct from the square mark that means "chosen" (SoftCheck). Done,
// it fills with the text's own ink (the style's rule: checks are ink, the
// accent is kept for the cursor and for what is chosen).
export function SoftTaskCheck({
  checked,
  size = 21,
  ink,
  faint,
  paper,
}: {
  checked: boolean;
  size?: number;
  ink: string;
  faint: string;
  paper: string;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: checked ? 0 : 1.8,
        borderColor: faint,
        backgroundColor: checked ? ink : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked && (
        <Svg width={size * 0.66} height={size * 0.66} viewBox="0 0 24 24">
          <Path d="M6.6 12.6l3.4 3.3L17.4 8.6" stroke={paper} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      )}
    </View>
  );
}
