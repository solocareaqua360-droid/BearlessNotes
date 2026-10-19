import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { FONT_SEMIBOLD } from '../utils/fonts';
import miniatures from './blockMiniatures.json';

// A BLOCK AS A PICTURE OF ITS RESULT (the Mac's insert panel and «/» popup, 2026-10-20, the user: «маленька іконка на
// великому білому фоні - збільшити іконку не вирішить, треба продумати»). Each block is drawn as what it will look like in
// the note - lines, boxes, a photo frame, a code slab - in our tones, so the eye finds it by shape and colour, not by
// reading. The shapes are DATA (blockMiniatures.json): the same file draws the sketch and this component.
type Shape = {
  t: 'rect' | 'line' | 'circle' | 'path' | 'text';
  x?: number; y?: number; w?: number; h?: number; r?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  cx?: number; cy?: number; d?: string; txt?: string; size?: number; bold?: boolean; anchor?: 'middle';
  f?: string; s?: string; sw?: number; nf?: boolean; dash?: string;
};

const LIGHT: Record<string, string> = {
  ink: '#1F1E1B', mute: '#9E9B93', faint: '#CFCCC4', line: '#E3E0D8', paper: '#FFFFFF', onAccent: '#FFFFFF',
  mist: '#E6E8EA', sand: '#EADFC8', sage: '#B3C9B9', clay: '#D9B7AB', copper: '#D9AE82', stone: '#D8D6D0',
  graphite: '#4A4946', rust: '#C8713F', link: '#2563EB', linkBg: 'rgba(37,99,235,0.14)',
};
const DARK: Record<string, string> = {
  ink: '#F1F0EC', mute: '#8E8B85', faint: '#4A4946', line: '#3A3936', paper: '#2A2A28', onAccent: '#FFFFFF',
  mist: '#3A4550', sand: '#5A4F36', sage: '#47604F', clay: '#6B4A40', copper: '#7A5430', stone: '#4A4946',
  graphite: '#1C1C1B', rust: '#D9814F', link: '#8AB0FF', linkBg: 'rgba(138,176,255,0.2)',
};

export default function BlockMiniature({ kind, width = 94 }: { kind: string; width?: number }) {
  const scheme = useTheme().scheme;
  const pal = scheme === 'dark' ? DARK : LIGHT;
  const shapes = (miniatures as unknown as Record<string, Shape[]>)[kind] ?? [];
  const colour = (k?: string) => (k ? pal[k] ?? k : undefined);
  return (
    <Svg width={width} height={(width * 44) / 64} viewBox="0 0 64 44">
      {shapes.map((sh, i) => {
        const fill = sh.nf ? 'none' : colour(sh.f) ?? 'none';
        const stroke = colour(sh.s);
        const common = { fill, stroke, strokeWidth: sh.sw, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
        if (sh.t === 'rect') return <Rect key={i} x={sh.x} y={sh.y} width={sh.w} height={sh.h} rx={sh.r} {...common} />;
        if (sh.t === 'circle') return <Circle key={i} cx={sh.cx} cy={sh.cy} r={sh.r} {...common} />;
        if (sh.t === 'path') return <Path key={i} d={sh.d} {...common} />;
        if (sh.t === 'line') return <Line key={i} x1={sh.x1} y1={sh.y1} x2={sh.x2} y2={sh.y2} stroke={stroke} strokeWidth={sh.sw} strokeLinecap="round" strokeDasharray={sh.dash} />;
        return (
          <SvgText key={i} x={sh.x} y={sh.y} fontFamily={FONT_SEMIBOLD} fontSize={sh.size} fontWeight={sh.bold ? '700' : '400'} fill={colour(sh.f)} textAnchor={sh.anchor === 'middle' ? 'middle' : 'start'}>
            {sh.txt}
          </SvgText>
        );
      })}
    </Svg>
  );
}
