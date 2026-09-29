import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons as VectorIonicons } from '@expo/vector-icons';
import Svg, { Circle, Line, Path, Polygon, Rect } from 'react-native-svg';
import { FROM_IONICONS, LUCIDE, SOLID_IONICONS, type IconElement } from './lucideIcons';

// THE APP'S ICONS, in the soft style (see theme/soft and SoftIcon) - the
// promised rework of every icon, not only the dozen the soft bar drew.
//
// Screens still say `<Ionicons name="trash-outline" />`, and this is the
// Ionicons they now import: the SAME name picks a Lucide icon (ISC
// licence, vendored in lucideIcons.ts - no new dependency, so no new APK)
// drawn the way SoftIcon draws: one line weight matched to the text,
// round ends, in the text's own ink. What made the old set read as
// Android was never one glyph but Material's habits across all of them,
// so the whole set changes at once rather than screen by screen.
//
// A name that has no match still draws its Ionicon, so nothing can go
// blank - add it to FROM_IONICONS (map.py in the generator) instead.
type Props = ComponentProps<typeof VectorIonicons>;

function renderElement([kind, attrs]: IconElement, key: number, stroke: string, fill: string) {
  const common = { stroke, fill, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const a = attrs as Record<string, string>;
  switch (kind) {
    case 'path':
      return <Path key={key} d={a.d} {...common} />;
    case 'circle':
      return <Circle key={key} cx={a.cx} cy={a.cy} r={a.r} {...common} />;
    case 'rect':
      return <Rect key={key} x={a.x} y={a.y} width={a.width} height={a.height} rx={a.rx} ry={a.ry} {...common} />;
    case 'line':
      return <Line key={key} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} {...common} />;
    case 'polygon':
      return <Polygon key={key} points={a.points} {...common} />;
    default:
      return null;
  }
}

function IoniconsSoft(props: Props) {
  const { name, size = 12, color = '#000', style, onPress, accessibilityLabel, testID } = props;
  const key = typeof name === 'string' && name.endsWith('-outline') ? name.slice(0, -8) : String(name);
  const lucide = FROM_IONICONS[key];
  const elements = lucide ? LUCIDE[lucide] : undefined;
  if (!elements) return <VectorIonicons {...props} />;

  const ink = typeof color === 'string' ? color : '#000';
  // Filled Ionicons that mean a state keep a solid form; '-outline'
  // names are always drawn as lines.
  const solid = name === key ? SOLID_IONICONS[key] : undefined;
  const svg = (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={onPress ? undefined : (style as StyleProp<ViewStyle>)}
      accessibilityLabel={onPress ? undefined : accessibilityLabel}
      testID={onPress ? undefined : testID}
    >
      {elements.map((element, i) => {
        if (solid === 'all') return renderElement(element, i, ink, ink);
        if (solid === 'badge') return i === 0 ? renderElement(element, i, ink, ink) : renderElement(element, i, '#FFFFFF', 'none');
        if (solid === 'dot' && i > 0) {
          const [kind, attrs] = element;
          return renderElement([kind, { ...attrs, r: 5 }], i, ink, ink);
        }
        return renderElement(element, i, ink, 'none');
      })}
    </Svg>
  );
  if (!onPress) return svg;
  // Ionicons is a Text, and a Text takes a press; an Svg does not, so a
  // pressable icon gets the smallest Pressable round it.
  return (
    <Pressable
      onPress={onPress as () => void}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={StyleSheet.flatten(style as StyleProp<ViewStyle>)}
    >
      {svg}
    </Pressable>
  );
}

// `keyof typeof Ionicons.glyphMap` is how the app names icons in types,
// so the glyph map rides along unchanged.
export const Ionicons = Object.assign(IoniconsSoft, { glyphMap: VectorIonicons.glyphMap });
export default Ionicons;
