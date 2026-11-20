import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSoft } from '../theme/soft';
import { FEATURES } from '../features';
import { SOFT_SEMIBOLD } from '../utils/fonts';

// THE MIDDLE CARD'S SHAPE, shared (2026-10-15, the user's sketch, artifact CWewE7V9nE7GSxQvdALFXh): a card almost
// square, drawn as three layers - the back (colour, pattern or photo, laid by whoever owns the card), what lies in it
// (PageStack: a first page with the real thing on it and, behind it, only the edges of the others, tilted a little),
// and the white FRONT panel with its tab, standing low (FrontPanel). A folder uses it (ProjectFolders' FolderStack), and
// so do the photo, video and map collections (CollectionCard's M face) - the same silhouette, a different content.
// Only shapes: flat fills and a hairline, no shadow inside.
export const FOLDER_M_H = 200;
// THE SMALL CARD (2026-10-15, the user's sketch, artifact 9WnDhBhzWyeXKLFJnLtDzr): the same shape at half the middle
// card's height - two of them, with the column's gap between, stand beside one middle card. Its coloured strip is thin
// and only the CORNERS of what lies in it show above the front panel.
export const FOLDER_S_H = 95;
export const folderCardH = (small?: boolean) => (small ? FOLDER_S_H : FOLDER_M_H);

// The front panel's outline for a card w wide: the tab's top (T), the flat part's top (F), the tab 37% of the width.
export function frontGeometry(w: number, small?: boolean) {
  const H = folderCardH(small);
  const T = small ? 30 : Math.round(H * 0.505);
  const F = small ? 42 : Math.round(H * 0.635);
  const r = small ? 10 : 16;
  const te = w * 0.37;
  const se = w * (small ? 0.46 : 0.49);
  const d = `M0 ${H} L0 ${T + r} Q0 ${T} ${r} ${T} L${te} ${T} C${te + 9} ${T} ${te + 15} ${F} ${se} ${F} L${w - r} ${F} Q${w} ${F} ${w} ${F + r} L${w} ${H} Z`;
  return { H, T, F, d };
}

// The first page and the edges of up to two more behind it. `edges`: how many (0-2). `page` draws the first page's
// content at the size it is given; the page is clipped to its rounded corners.
export function PageStack({ w, edges, page, small }: { w: number; edges: number; page: (pw: number, ph: number) => ReactNode; small?: boolean }) {
  const S = useSoft();
  const H = FOLDER_M_H;
  const dark = S.dark;
  const paper = dark ? ['#2C2C2E', '#252527', '#202022'] : ['#FFFFFF', '#FBF8F2', '#F1ECE2'];
  const edge = dark ? '#3A3A3C' : '#E6E3DC';
  if (small) {
    // Only the top corners of two pages, tilted apart, above the front panel's edge.
    const bar = dark ? '#3F3F42' : '#E4E1DA';
    return (
      <>
        {edges > 0 && (
          <View pointerEvents="none" style={{ position: 'absolute', left: Math.round(w * 0.55), top: 9, width: Math.round(w * 0.37), height: 60, borderRadius: 6, backgroundColor: paper[2], transform: [{ rotate: '7deg' }] }} />
        )}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: Math.round(w * 0.43), top: 13, width: Math.round(w * 0.4), height: 60, borderRadius: 6, backgroundColor: paper[0], borderWidth: 1, borderColor: edge, paddingHorizontal: 9, paddingTop: 7, gap: 5, transform: [{ rotate: '-5deg' }] }}
        >
          <View style={{ height: 3, width: '70%', borderRadius: 2, backgroundColor: bar }} />
          <View style={{ height: 3, width: '50%', borderRadius: 2, backgroundColor: bar }} />
        </View>
      </>
    );
  }
  const pageW = Math.round(w * 0.557);
  const pageH = Math.round(H * 0.825);
  const left = Math.round(w * 0.19);
  const sheet = (dx: number, top: number, color: string, tilt: number, border: boolean) => ({
    position: 'absolute' as const,
    left: left + dx,
    top,
    width: pageW,
    height: pageH,
    borderRadius: 9,
    backgroundColor: color,
    borderWidth: border ? 1 : 0,
    borderColor: edge,
    transform: [{ rotate: `${tilt}deg` }],
  });
  return (
    <>
      {edges > 1 && <View pointerEvents="none" style={sheet(18, 6, paper[2], 6, false)} />}
      {edges > 0 && <View pointerEvents="none" style={sheet(10, 11, paper[1], 3, false)} />}
      <View pointerEvents="none" style={[sheet(0, 17, paper[0], -1.5, true), { overflow: 'hidden' }]}>
        {page(pageW, pageH)}
      </View>
    </>
  );
}

// The white front panel with the name on it and, at the foot, the count - a big number and its small word.
export function FrontPanel({ w, title, number, unit, small }: { w: number; title: string; number: number; unit: string; small?: boolean }) {
  const S = useSoft();
  const { H, F, d } = frontGeometry(w, small);
  return (
    <>
      <Svg pointerEvents="none" width={w} height={H} style={{ position: 'absolute', left: 0, top: 0 }}>
        <Path d={d} fill={S.card} stroke={S.dark ? '#3A3A3C' : '#E0DDD6'} strokeWidth={1} />
      </Svg>
      <Text pointerEvents="none" numberOfLines={1} style={{ position: 'absolute', left: 14, right: 14, top: F + (small ? 5 : 12), color: S.ink, fontSize: small ? 15 : 16, lineHeight: small ? 18 : 19, fontFamily: SOFT_SEMIBOLD, letterSpacing: -0.2 }}>
        {title}
      </Text>
      <Text pointerEvents="none" numberOfLines={1} style={{ position: 'absolute', left: 14, right: 14, bottom: small ? 8 : 12, color: S.ink3, fontSize: 12, fontFamily: SOFT_SEMIBOLD }}>
        <Text style={{ color: FEATURES.ourTones ? S.accent : S.ink, fontSize: small ? 16 : 22, fontFamily: SOFT_SEMIBOLD }}>{number}</Text>
        {` ${unit}`}
      </Text>
    </>
  );
}
