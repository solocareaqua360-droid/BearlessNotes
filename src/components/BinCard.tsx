import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';
import Svg, { ClipPath, Defs, Ellipse, G, Line, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { useSoft } from '../theme/soft';
import { SOFT_BOLD, SOFT_SEMIBOLD } from '../utils/fonts';
import { FOLDER_M_H } from './folderShape';

// THE BIN AS A WIRE WASTEBASKET (2026-10-15, the user's sketch, artifact CWewE7V9nE7GSxQvdALFXh boards 6-7): a white
// square the size of a middle folder card with a tall mesh basket on it, the deleted things lying in it - outlines
// of cards seen through the mesh all the way down, the top ones sticking up over the rim. It EMPTIES as the bin does:
// the fewer there are, the fewer cards lie in it (from the top down); an empty bin is an empty basket, and the card
// stays. Cards are plain shapes (flat fills, no pictures): a page with lines, or a photo block in a muted tone.
const W = 212;
const H = FOLDER_M_H;
// The body: the front rim's arc on top, the bottom arc under (a basket a little wider at the rim).
const BODY = 'M58 44 L67 148 A39 7 0 0 0 145 148 L154 44 A48 8 0 0 1 58 44 Z';

// The slots a deleted thing can lie in, from the bottom of the basket up: [x, y, tilt, tone] (tone: 0 a page, 1-3 a photo).
const SLOTS: [number, number, number, number][] = [
  [78, 106, 10, 0], [100, 108, -6, 1], [120, 108, 12, 0],
  [74, 86, -8, 2], [98, 88, 14, 0], [118, 90, -12, 3],
  [72, 66, 12, 0], [98, 64, -9, 1], [118, 68, 8, 0],
  [78, 18, -14, 0], [100, 6, 5, 1], [122, 16, 14, 0], [86, 32, 9, 2], [108, 28, -7, 0], [126, 34, 11, 3],
];
const PHOTO_LIGHT = ['', '#D8C6AC', '#B9CDB6', '#B7C6DC'];
const PHOTO_DARK = ['', '#5A4A38', '#43563F', '#3F5068'];

export function binSlotsFor(count: number) {
  return count <= 0 ? 0 : Math.min(SLOTS.length, Math.max(1, Math.round(count * 0.7)));
}

export default function BinCard({ count, kinds, onPress }: { count: number; kinds: string[]; onPress: () => void }) {
  const S = useSoft();
  const [w, setW] = useState(0);
  const dark = S.dark;
  const rim = dark ? '#6B6963' : '#A9A69E';
  const mesh = dark ? '#5E5C58' : '#ABA79F';
  const inner = dark ? '#121212' : '#ECE9E3';
  const veil = dark ? '#1E1E1F' : '#FFFFFF';
  const paper = dark ? '#2C2C2E' : '#FFFFFF';
  const paperEdge = dark ? '#3A3A3C' : '#D9D6CF';
  const bar = dark ? '#3F3F42' : '#E4E1DA';
  const tones = dark ? PHOTO_DARK : PHOTO_LIGHT;
  const n = binSlotsFor(count);
  const left = Math.round((w - W) / 2);
  const lines: number[] = [];
  for (let d = -220; d <= 440; d += 18) lines.push(d);
  // THE VOLUME (2026-10-15, the user's: «плаский-плаский малюнок, як олівцем... треба додати об'єму»): the basket is a
  // cylinder - its sides in shade, a lighter band down the middle; the far wall's mesh seen through the near one; the
  // inside darker toward the back; a rim with thickness and a glint; a soft shadow on the card under its foot; the
  // things in it casting small shadows of their own.
  // As colour + opacity apart: react-native-svg draws an rgba() stop colour OPAQUE (it turned the basket into a solid
  // metal bucket, 2026-10-15).
  const shadeEdge = dark ? '#000000' : '#1E1E1C';
  const shadeEdgeA = dark ? 0.38 : 0.12;
  const shadeMidA = dark ? 0.04 : 0.1;
  const farMesh = dark ? '#3A3937' : '#D3D0C9';
  const glint = dark ? '#8A8780' : '#E9E7E2';
  return (
    <Pressable onPress={onPress} accessibilityLabel="Кошик" onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))} style={[styles.card, { backgroundColor: S.card, boxShadow: S.popShadow }]}>
      {w > 0 && (
        <View pointerEvents="none" style={{ position: 'absolute', left, top: 0, width: W, height: H }}>
          {/* The back: the basket's inside and the far half of the rim. */}
          <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
            <Defs>
              <RadialGradient id="binFoot" cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0" stopColor={dark ? '#000000' : '#1E1E1C'} stopOpacity={dark ? 0.55 : 0.22} />
                <Stop offset="1" stopColor={dark ? '#000000' : '#1E1E1C'} stopOpacity={0} />
              </RadialGradient>
              <LinearGradient id="binInside" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={dark ? '#050505' : '#CFCBC3'} />
                <Stop offset="1" stopColor={inner} />
              </LinearGradient>
              <ClipPath id="binBack">
                <Path d={BODY} />
              </ClipPath>
            </Defs>
            {/* The shadow it stands in. */}
            <Ellipse cx={108} cy={150} rx={52} ry={9} fill="url(#binFoot)" />
            <Ellipse cx={106} cy={44} rx={48} ry={8} fill="url(#binInside)" />
            {/* The far wall: the same mesh, paler, seen through the near one. */}
            <G clipPath="url(#binBack)">
              {lines.map((d) => (
                <G key={d}>
                  <Line x1={d + 9} y1={0} x2={d + 209} y2={200} stroke={farMesh} strokeWidth={0.8} />
                  <Line x1={d + 9} y1={200} x2={d + 209} y2={0} stroke={farMesh} strokeWidth={0.8} />
                </G>
              ))}
            </G>
            <Path d="M58 44 A48 8 0 0 1 154 44" fill="none" stroke={rim} strokeWidth={2.4} />
          </Svg>
          {/* What lies in it: the top ones first (behind), the lower ones over them; each leaves by fading when the bin empties. */}
          {SLOTS.slice(0, n)
            .map((slot, i) => ({ slot, i }))
            .reverse()
            .map(({ slot: [x, y, tilt, tone], i }) => (
              <Animated.View
                key={i}
                exiting={FadeOut.duration(280)}
                style={{
                  position: 'absolute',
                  left: x,
                  top: y,
                  width: 28,
                  height: 35,
                  borderRadius: 4,
                  backgroundColor: paper,
                  borderWidth: 1,
                  borderColor: paperEdge,
                  boxShadow: dark ? '0px 1px 3px rgba(0,0,0,0.5)' : '0px 1px 3px rgba(30,30,28,0.16)',
                  opacity: y > 50 ? 0.8 : 1,
                  transform: [{ rotate: `${tilt}deg` }],
                  transformOrigin: [0, 0, 0],
                }}
              >
                {(kinds[i] !== undefined ? kinds[i] === 'photo' : tone > 0) ? (
                  <View style={{ position: 'absolute', left: 3, top: 3, width: 20, height: 24, borderRadius: 2, backgroundColor: tones[tone || 1 + (i % 3)] }} />
                ) : (
                  <>
                    <View style={{ position: 'absolute', left: 5, top: 7, width: 17, height: 3, borderRadius: 1.5, backgroundColor: bar }} />
                    <View style={{ position: 'absolute', left: 5, top: 14, width: 13, height: 3, borderRadius: 1.5, backgroundColor: bar }} />
                  </>
                )}
              </Animated.View>
            ))}
          {/* The front: a veil over the cards, the mesh, and the rim. */}
          <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
            <Defs>
              <ClipPath id="binBody">
                <Path d={BODY} />
              </ClipPath>
              <LinearGradient id="binShade" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={shadeEdge} stopOpacity={shadeEdgeA} />
                <Stop offset="0.3" stopColor="#FFFFFF" stopOpacity={shadeMidA} />
                <Stop offset="0.45" stopColor="#FFFFFF" stopOpacity={shadeMidA} />
                <Stop offset="1" stopColor={shadeEdge} stopOpacity={shadeEdgeA} />
              </LinearGradient>
              <LinearGradient id="binDeep" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={dark ? '#000000' : '#1E1E1C'} stopOpacity={dark ? 0.25 : 0.08} />
                <Stop offset="0.5" stopColor={dark ? '#000000' : '#1E1E1C'} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={BODY} fill={veil} fillOpacity={0.32} />
            {/* Round: the sides in shade, a light band left of the middle; the top under the rim a little darker. */}
            <Path d={BODY} fill="url(#binShade)" />
            <Path d={BODY} fill="url(#binDeep)" />
            {/* The mesh ON TOP of the shading - under it the basket read as a solid bucket (the user, 2026-10-15). */}
            <G clipPath="url(#binBody)">
              {lines.map((d) => (
                <G key={d}>
                  <Line x1={d} y1={0} x2={d + 200} y2={200} stroke={mesh} strokeWidth={1.2} />
                  <Line x1={d} y1={200} x2={d + 200} y2={0} stroke={mesh} strokeWidth={1.2} />
                </G>
              ))}
            </G>
            <Path d="M58 44 L67 148" fill="none" stroke={rim} strokeWidth={1.6} />
            <Path d="M154 44 L145 148" fill="none" stroke={rim} strokeWidth={1.6} />
            {/* The foot: a band with thickness. */}
            <Path d="M67 148 A39 7 0 0 0 145 148" fill="none" stroke={rim} strokeWidth={3} />
            {/* The rim: a tube - thick, with a glint along its top. */}
            <Path d="M154 44 A48 8 0 0 1 58 44" fill="none" stroke={rim} strokeWidth={3.4} />
            <Path d="M150 46.6 A46 7 0 0 1 64 47.2" fill="none" stroke={glint} strokeWidth={1} strokeLinecap="round" />
          </Svg>
        </View>
      )}
      <Text pointerEvents="none" numberOfLines={1} style={[styles.name, { color: S.ink }]}>
        Кошик
      </Text>
      <Text pointerEvents="none" style={[styles.count, { color: S.ink3 }]}>
        {count}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { height: FOLDER_M_H, borderRadius: 24, overflow: 'hidden' },
  name: { position: 'absolute', left: 14, bottom: 14, fontSize: 16, fontFamily: SOFT_BOLD },
  count: { position: 'absolute', right: 14, bottom: 14, fontSize: 15, fontFamily: SOFT_SEMIBOLD },
});
