import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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

const THIN_W = 54;
const GAP = 8;
const SIDE = 20;

export default function ProjectsBand({
  groups,
  focusId,
  onFocus,
  counts,
  noneCount,
  height,
  topPad,
  rootFor,
  onRootPress,
}: {
  groups: Group[];
  focusId: string;
  onFocus: (id: string) => void;
  counts: Map<string, BandCount>;
  noneCount: number;
  // The band stands as tall as an opened folder's cover (the user, 2026-10-22), with `topPad` clear for the top bar.
  height: number;
  topPad: number;
  // The name of the folder that IS the front project (its root), if any; a tap opens that folder's project settings.
  rootFor?: (projectId: string) => string | null;
  onRootPress?: (projectId: string) => void;
}) {
  const S = useSoft();
  const { width: winW } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const stops: { id: string; name: string; color: string | null; sub: string }[] = [
    { id: NO_PROJECT, name: 'Без проєкту', color: null, sub: word(noneCount) },
    ...groups.map((g) => ({ id: g.id, name: g.name, color: g.color, sub: word(counts.get(g.id)?.folders ?? 0) })),
  ];
  const at = Math.max(0, stops.findIndex((s) => s.id === focusId));
  // The wide card is most of the screen; the others keep a fixed thin width and run on past the edge - the row is longer than the screen
  // and slides, instead of squeezing every project into one view.
  const wideW = Math.round(winW * 0.72);
  const cardH = Math.max(150, height - topPad - 40);
  const widths = stops.map((_, i) => (i === at ? wideW : THIN_W));
  const offsetOf = (i: number) => widths.slice(0, i).reduce((x, w) => x + w + GAP, 0);
  useEffect(() => {
    // The previous strip peeks in at the left edge.
    scroller.current?.scrollTo({ x: Math.max(0, offsetOf(at) - (SIDE + THIN_W + GAP)), animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, wideW, stops.length]);
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
    <View style={[styles.wrap, { height, paddingTop: topPad }]}>
      <GestureDetector gesture={swipe}>
        <View style={{ height: cardH }}>
          <ScrollView
            ref={scroller}
            horizontal
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: SIDE, gap: GAP }}
          >
            {stops.map((s, i) => {
              const on = i === at;
              const bg = s.color ? tint(s.color, S.dark ? 0.38 : 0.28, S.card) : S.fill;
              return (
                <Animated.View key={s.id || 'none'} layout={LinearTransition.duration(220)} style={{ width: widths[i], height: cardH }}>
                  <Pressable
                    onPress={() => onFocus(s.id)}
                    accessibilityLabel={s.name}
                    style={[styles.card, { backgroundColor: bg }, on ? styles.cardWide : styles.cardThin]}
                  >
                    {on && !!rootFor?.(s.id) && (
                      <Pressable
                        onPress={() => onRootPress?.(s.id)}
                        hitSlop={8}
                        accessibilityLabel="Папка-корінь проєкту"
                        style={{ position: 'absolute', top: 14, left: 16, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 13, backgroundColor: S.card, opacity: 0.9 }}
                      >
                        <Text style={{ fontSize: 12, color: S.ink2, fontFamily: SOFT_MEDIUM }} numberOfLines={1}>
                          папка «{rootFor?.(s.id)}» · змінити
                        </Text>
                      </Pressable>
                    )}
                    {on ? (
                      <View>
                        <Text numberOfLines={2} style={[styles.name, { color: S.ink }]}>{s.name}</Text>
                        <Text numberOfLines={1} style={[styles.sub, { color: S.ink2 }]}>{s.sub}</Text>
                      </View>
                    ) : (
                      <Text numberOfLines={1} style={[styles.turned, { color: S.ink, width: cardH - 28 }]}>{s.name}</Text>
                    )}
                  </Pressable>
                </Animated.View>
              );
            })}
          </ScrollView>
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
  wrap: { marginHorizontal: -20 },
  card: { flex: 1, borderRadius: 26, overflow: 'hidden' },
  cardWide: { justifyContent: 'flex-end', padding: 18 },
  cardThin: { alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: SOFT_SEMIBOLD, fontSize: 30, letterSpacing: -0.6 },
  sub: { fontFamily: SOFT_MEDIUM, fontSize: 14, marginTop: 3 },
  turned: { fontFamily: SOFT_SEMIBOLD, fontSize: 14, textAlign: 'center', transform: [{ rotate: '-90deg' }] },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, paddingTop: 12 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
