import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import type { Group } from '../types';

// THE PROJECTS BAND (2026-10-22, the user: «зверху гармошка проєктів... свайп листає лише у цьому верхньому полі»): the explorer's first level
// in the «Проєкти» style opens with one wide card (the project in front) between thin strips with the other names, and dots under them.
// The first stop is «Без проєкту». A sideways swipe is the band's own - the rest of the screen keeps the left swipe that picks cards - and a
// tap on a strip or a dot goes there too (a narrow strip is easy to miss with a thumb). Nothing animates per frame: the layout moves once.
export const NO_PROJECT = '';

export type BandCount = { folders: number };

const BAND_H = 116;

export default function ProjectsBand({
  groups,
  focusId,
  onFocus,
  counts,
  noneCount,
}: {
  groups: Group[];
  focusId: string;
  onFocus: (id: string) => void;
  counts: Map<string, BandCount>;
  noneCount: number;
}) {
  const S = useSoft();
  const stops: { id: string; name: string; color: string | null; sub: string }[] = [
    { id: NO_PROJECT, name: 'Без проєкту', color: null, sub: word(noneCount) },
    ...groups.map((g) => ({ id: g.id, name: g.name, color: g.color, sub: word(counts.get(g.id)?.folders ?? 0) })),
  ];
  const at = Math.max(0, stops.findIndex((s) => s.id === focusId));
  const step = (d: number) => {
    const next = stops[Math.max(0, Math.min(stops.length - 1, at + d))];
    if (next && next.id !== focusId) onFocus(next.id);
  };
  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-14, 14])
    .failOffsetY([-14, 14])
    .onEnd((e) => {
      if (e.translationX < -40 || e.velocityX < -600) step(1);
      else if (e.translationX > 40 || e.velocityX > 600) step(-1);
    });
  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={swipe}>
        <View style={styles.row}>
          {stops.map((s) => {
            const on = s.id === focusId;
            const bg = s.color ? tint(s.color, S.dark ? 0.38 : 0.28, S.card) : S.fill;
            return (
              <Animated.View key={s.id || 'none'} layout={LinearTransition.duration(220)} style={on ? styles.wide : styles.thin}>
                <Pressable
                  onPress={() => onFocus(s.id)}
                  accessibilityLabel={s.name}
                  style={[styles.card, { backgroundColor: bg }, on ? styles.cardWide : styles.cardThin]}
                >
                  {on ? (
                    <View>
                      <Text numberOfLines={1} style={[styles.name, { color: S.ink }]}>{s.name}</Text>
                      <Text numberOfLines={1} style={[styles.sub, { color: S.ink2 }]}>{s.sub}</Text>
                    </View>
                  ) : (
                    <Text numberOfLines={1} style={[styles.turned, { color: S.ink }]}>{s.name}</Text>
                  )}
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
      </GestureDetector>
      <View style={styles.dots}>
        {stops.map((s) => (
          <Pressable key={s.id || 'none'} hitSlop={8} onPress={() => onFocus(s.id)} accessibilityLabel={s.name}>
            <View style={[styles.dot, { backgroundColor: s.id === focusId ? S.ink : S.line }]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function word(n: number): string {
  return `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'папка' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'папки' : 'папок'}`;
}

// The project's colour laid over the card colour at `amount`: a soft wash, never the raw swatch.
function tint(hex: string, amount: number, base: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  const b = /^#([0-9a-f]{6})$/i.exec(base);
  if (!m) return base;
  const to = (h: string) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const c = to(m[1]);
  const o = b ? to(b[1]) : [255, 255, 255];
  const mix = c.map((v, i) => Math.round(v * amount + o[i] * (1 - amount)));
  return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  row: { flexDirection: 'row', gap: 6, height: BAND_H },
  wide: { flex: 1, minWidth: 0 },
  thin: { width: 34 },
  card: { flex: 1, borderRadius: 20, overflow: 'hidden' },
  cardWide: { justifyContent: 'flex-end', padding: 12 },
  cardThin: { alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: SOFT_SEMIBOLD, fontSize: 22, letterSpacing: -0.4 },
  sub: { fontFamily: SOFT_MEDIUM, fontSize: 12, marginTop: 2 },
  turned: { fontFamily: SOFT_SEMIBOLD, fontSize: 12, width: BAND_H - 20, textAlign: 'center', transform: [{ rotate: '-90deg' }] },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, paddingTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
