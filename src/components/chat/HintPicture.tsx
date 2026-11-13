import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useSoft } from '../../theme/soft';
import { chatColours } from './chatTokens';

export type HintKind = 'table' | 'short' | 'board' | 'plan' | 'more' | 'simple' | 'research' | 'sum' | 'adapt';

// WHAT AN ACTION DOES, AS A PICTURE (the user, 2026-10-24: in the hints «важливі не стільки слова скільки картинки дій»): a table,
// a text growing shorter, a tree of cards, a checklist... The same drawings as the sketch (scratchpad aichat5.py pic()), on a
// 92x58 field, in the theme's own colours.
export default function HintPicture({ kind, width = 92, height = 58 }: { kind: HintKind; width?: number; height?: number }) {
  const S = useSoft();
  const C = chatColours(S);
  const L = C.faint;
  const D = S.ink;
  const A = S.accent;
  const bar = (key: string, x: number, y: number, w: number, c = L, h = 4) => <Rect key={key} x={x} y={y} width={w} height={h} rx={2} fill={c} />;
  const arrow = (x: number, y: number) => (
    <Path d={`M${x} ${y}h8M${x + 5} ${y - 4}l4 4-4 4`} stroke={A} strokeWidth={2} fill="none" strokeLinecap="round" />
  );
  let body: React.ReactNode = null;
  if (kind === 'table') {
    body = [0, 1, 2].flatMap((r) =>
      [0, 1, 2].map((c) => <Rect key={`${r}${c}`} x={10 + c * 25} y={9 + r * 14} width={22} height={11} rx={2} fill={r === 0 ? A : L} opacity={r === 0 ? 0.9 : 0.55} />)
    );
  } else if (kind === 'short') {
    body = (
      <>
        {bar('a', 8, 10, 34)}
        {bar('b', 8, 18, 30)}
        {bar('c', 8, 26, 36)}
        {bar('d', 8, 34, 26)}
        {bar('e', 8, 42, 32)}
        <Path d="M48 28h10M54 24l4 4-4 4" stroke={A} strokeWidth={2} fill="none" strokeLinecap="round" />
        {bar('f', 64, 24, 22, D, 6)}
      </>
    );
  } else if (kind === 'board') {
    body = (
      <>
        <Path d="M30 29C38 29 38 13 46 13M30 29C38 29 38 29 46 29M30 29C38 29 38 45 46 45" stroke={L} strokeWidth={1.6} fill="none" />
        <Rect x={8} y={22} width={22} height={14} rx={4} fill={A} />
        {[8, 24, 40].map((y) => (
          <Rect key={y} x={46} y={y} width={36} height={11} rx={3} fill={D} opacity={0.75} />
        ))}
      </>
    );
  } else if (kind === 'plan') {
    body = [0, 1, 2].map((i) => (
      <G key={i}>
        <Rect x={10} y={9 + i * 14} width={10} height={10} rx={3} fill={i < 2 ? A : 'none'} stroke={A} strokeWidth={1.6} />
        {i < 2 && <Path d={`M12.5 ${14 + i * 14}l2 2 3.5-4`} stroke="#fff" strokeWidth={1.6} fill="none" />}
        {bar(`p${i}`, 26, 12 + i * 14, 50 - i * 8)}
      </G>
    ));
  } else if (kind === 'more') {
    body = (
      <>
        {bar('a', 8, 10, 40, D, 5)}
        {bar('b', 8, 20, 70)}
        {bar('c', 8, 28, 64)}
        {bar('d', 8, 36, 70)}
        {bar('e', 8, 44, 50)}
        <Circle cx={74} cy={13} r={7} fill={A} />
        <Path d="M74 10v6M71 13h6" stroke="#fff" strokeWidth={1.8} />
      </>
    );
  } else if (kind === 'simple') {
    body = (
      <>
        <Rect x={6} y={10} width={34} height={34} rx={8} fill={L} opacity={0.55} />
        <SvgText x={23} y={33} fontSize={13} textAnchor="middle" fill={D} fontWeight="700">
          Ab
        </SvgText>
        {arrow(44, 27)}
        <Rect x={56} y={14} width={28} height={26} rx={13} fill={A} opacity={0.2} />
        <Circle cx={66} cy={25} r={1.6} fill={D} />
        <Circle cx={74} cy={25} r={1.6} fill={D} />
        <Path d="M64 31c3 3 9 3 12 0" stroke={D} strokeWidth={1.6} fill="none" />
      </>
    );
  } else if (kind === 'research') {
    body = (
      <>
        {bar('a', 8, 10, 50)}
        {bar('b', 8, 18, 44)}
        {bar('c', 8, 26, 52)}
        {bar('d', 8, 34, 40)}
        <Circle cx={64} cy={32} r={11} fill="none" stroke={A} strokeWidth={2.4} />
        <Path d="M72 40l8 8" stroke={A} strokeWidth={2.6} strokeLinecap="round" />
      </>
    );
  } else if (kind === 'sum') {
    body = (
      <>
        {[0, 1, 2, 3, 4].map((i) => bar(`s${i}`, 8, 8 + i * 9, 28 + (i % 2) * 8))}
        {arrow(46, 29)}
        <Rect x={60} y={18} width={26} height={22} rx={5} fill={C.wash} />
        {bar('x', 64, 24, 18, A)}
        {bar('y', 64, 31, 12, A)}
      </>
    );
  } else {
    body = (
      <>
        <Rect x={6} y={12} width={34} height={22} rx={10} fill={L} opacity={0.6} />
        <Path d="M14 34l-4 6 9-6" fill={L} opacity={0.6} />
        {arrow(44, 23)}
        <Rect x={56} y={12} width={32} height={22} rx={10} fill={A} opacity={0.85} />
        <Path d="M80 34l4 6-9-6" fill={A} opacity={0.85} />
        {bar('a', 62, 19, 18, '#fff', 3)}
        {bar('b', 62, 25, 12, '#fff', 3)}
      </>
    );
  }
  return (
    <Svg width={width} height={height} viewBox="0 0 92 58">
      {body}
    </Svg>
  );
}
