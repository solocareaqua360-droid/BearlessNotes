import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { perfNoIcons } from '../../utils/perfWatch';
import { Ionicons as VectorIonicons } from '@expo/vector-icons';
import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';
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

export function renderElement([kind, attrs]: IconElement, key: number, stroke: string, fill: string) {
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
    case 'polyline':
      return <Polyline key={key} points={a.points} {...common} />;
    case 'ellipse':
      return <Ellipse key={key} cx={a.cx} cy={a.cy} rx={a.rx} ry={a.ry} {...common} />;
    default:
      return null;
  }
}

// An icon's line shapes by its app name (the same lookup the icon below makes), for whoever draws many icons inside
// ONE Svg of its own - FolderPattern. Null when the name has no Lucide drawing.
export function lucideElementsOf(name: string): IconElement[] | null {
  const key = name.endsWith('-outline') ? name.slice(0, -8) : name;
  const lucide = key.startsWith('lc:') ? key.slice(3) : FROM_IONICONS[key];
  return (lucide && LUCIDE[lucide]) || null;
}

// ONE SHAPE PER ICON (2026-11-16, the optimisation pass, measured: with every icon drawn as an empty square the records of a
// base were built in 35-43 ms instead of 77-89 - half of a card's cost was its icons). A Lucide icon is up to six shapes
// (paths, circles, lines, rects), and each was a native shape of its own; drawn with lines only, they are all one outline,
// so they are joined into ONE path, worked out once per icon and kept. The icons with a filled part keep their shapes.
const n = (v: string | number | undefined) => Number(v ?? 0);
function shapeToD([kind, attrs]: IconElement): string | null {
  const a = attrs as Record<string, string | number>;
  switch (kind) {
    case 'path':
      return String(a.d);
    case 'circle': {
      const cx = n(a.cx), cy = n(a.cy), r = n(a.r);
      return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    }
    case 'ellipse': {
      const cx = n(a.cx), cy = n(a.cy), rx = n(a.rx), ry = n(a.ry);
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
    }
    case 'line':
      return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`;
    case 'polyline':
    case 'polygon': {
      const pts = String(a.points).trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return null;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
      return kind === 'polygon' ? `${d}Z` : d;
    }
    case 'rect': {
      const x = n(a.x), y = n(a.y), w = n(a.width), h = n(a.height);
      let rx = a.rx !== undefined ? n(a.rx) : a.ry !== undefined ? n(a.ry) : 0;
      let ry = a.ry !== undefined ? n(a.ry) : rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`;
    }
    default:
      return null;
  }
}
const joined = new Map<string, string | null>();
function joinedPath(name: string, elements: IconElement[]): string | null {
  if (joined.has(name)) return joined.get(name)!;
  const parts = elements.map(shapeToD);
  const d = parts.every((p) => p !== null) ? parts.join('') : null;
  joined.set(name, d);
  return d;
}

function IoniconsSoft(props: Props) {
  const { name, size = 12, color = '#000', style, onPress, accessibilityLabel, testID } = props;
  if (perfNoIcons()) return <View style={[{ width: size, height: size }, style as StyleProp<ViewStyle>]} />;
  const key = typeof name === 'string' && name.endsWith('-outline') ? name.slice(0, -8) : String(name);
  // 'lc:<name>': a Lucide icon chosen by its own name in the icon picker
  // (constants/iconCatalog) - no Ionicons name stands behind it.
  const direct = key.startsWith('lc:');
  const lucide = direct ? key.slice(3) : FROM_IONICONS[key];
  const elements = lucide ? LUCIDE[lucide] : undefined;
  if (!elements) return direct ? <Svg width={size} height={size} /> : <VectorIonicons {...props} />;

  const ink = typeof color === 'string' ? color : '#000';
  // Filled Ionicons that mean a state keep a solid form; '-outline'
  // names are always drawn as lines.
  const solid = name === key ? SOLID_IONICONS[key] : undefined;
  const one = !solid ? joinedPath(lucide!, elements) : null;
  const svg = (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={onPress ? undefined : (style as StyleProp<ViewStyle>)}
      accessibilityLabel={onPress ? undefined : accessibilityLabel}
      testID={onPress ? undefined : testID}
    >
      {one ? (
        <Path d={one} stroke={ink} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      ) : elements.map((element, i) => {
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
