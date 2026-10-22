import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import type { Group } from '../types';

// THE PROJECTS BAND (2026-10-22, the user: «зверху гармошка проєктів... свайп листає лише у цьому верхньому полі»): the explorer's first level
// in the «Проєкти» style opens with one wide card (the project in front) between thin strips with the other names, and dots under them.
// The first stop is «Без проєкту». A sideways swipe is the band's own - the rest of the screen keeps the left swipe that picks cards - and a
// tap on a strip or a dot goes there too (a narrow strip is easy to miss with a thumb).
//
// THE MOTION IS THE MULTITASK MENU'S (the user, 2026-10-22: the cards must really change size): ONE shared number, `focus` (which card is in
// front, fractional while moving), drives every card's width (wide at 1, thin at 0), the turn of its name from lying flat to standing on
// the edge, and the shift of the whole row. The finger writes `focus` while it drags; on lift it settles on the nearest card.
export const NO_PROJECT = '';

export type BandCount = { folders: number };

const THIN_W = 54;
const GAP = 8;
const SIDE = 20;
const NAME_H = 28;

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
  onHold,
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
  // A long press on the front card: the project's own settings (rename, cover colour, root folder, archive, delete).
  onHold?: (projectId: string) => void;
}) {
  const S = useSoft();
  const { width: winW } = useWindowDimensions();
  const stops: { id: string; name: string; color: string | null; cover?: string; sub: string }[] = [
    { id: NO_PROJECT, name: 'Без проєкту', color: null, cover: undefined as string | undefined, sub: word(noneCount) },
    ...groups.map((g) => ({ id: g.id, name: g.name, color: g.color, cover: g.cover, sub: word(counts.get(g.id)?.folders ?? 0) })),
  ];
  const n = stops.length;
  const at = Math.max(0, stops.findIndex((s) => s.id === focusId));
  const wideW = Math.round(winW * 0.72);
  const cardH = Math.max(150, height - topPad - 40);
  const inner = winW;
  const focus = useSharedValue(at);
  const start = useSharedValue(at);
  // A change from outside (a tap on a dot, the remembered project) glides there; a swipe has already put focus on the card.
  useEffect(() => {
    if (Math.abs(focus.value - at) > 0.001) focus.value = withTiming(at, { duration: 260, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);
  const pick = (i: number) => {
    const next = stops[Math.max(0, Math.min(n - 1, i))];
    if (next && next.id !== focusId) onFocus(next.id);
  };
  // One card's worth of finger travel moves focus by one: the distance between two card centres at rest.
  const step = Math.max(60, wideW / 2 + THIN_W / 2 + GAP);
  const swipe = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-14, 14])
    .onBegin(() => {
      start.value = focus.value;
    })
    .onUpdate((e) => {
      focus.value = Math.max(0, Math.min(n - 1, start.value - e.translationX / step));
    })
    .onEnd((e) => {
      const fling = e.velocityX < -700 ? 1 : e.velocityX > 700 ? -1 : 0;
      const target = Math.max(0, Math.min(n - 1, Math.round(focus.value + (fling === 0 ? 0 : fling * 0.5))));
      focus.value = withTiming(target, { duration: 240, easing: Easing.out(Easing.cubic) });
      runOnJS(pick)(target);
    });
  const rowStyle = useAnimatedStyle(() => {
    // The row is carried so the card in front stays centred (a card at the very end stays at the end): the same maths as the desks'.
    let x = 0;
    let middle = 0;
    for (let i = 0; i < n; i++) {
      const w = widthFor(i, focus.value, wideW);
      const t = Math.max(0, 1 - Math.abs(focus.value - i));
      middle += t * (x + w / 2);
      x += w + GAP;
    }
    const total = x - GAP;
    const shift = Math.max(0, Math.min(total - (inner - 2 * SIDE), middle - (inner - 2 * SIDE) / 2));
    return { transform: [{ translateX: -shift }] };
  });
  return (
    <View style={[styles.wrap, { height, paddingTop: topPad }]}>
      <GestureDetector gesture={swipe}>
        <View style={{ height: cardH, overflow: 'hidden' }}>
          <Animated.View style={[{ flexDirection: 'row', paddingHorizontal: SIDE, gap: GAP, height: cardH }, rowStyle]}>
            {stops.map((s, i) => (
              <BandCard
                key={s.id || 'none'}
                index={i}
                focus={focus}
                wideW={wideW}
                cardH={cardH}
                name={s.name}
                sub={s.sub}
                cover={s.cover}
                bg={s.color ? tint(s.color, S.dark ? 0.38 : 0.28, S.card) : S.fill}
                ink={s.cover ? '#fff' : S.ink}
                ink2={s.cover ? 'rgba(255,255,255,0.85)' : S.ink2}
                rootName={rootFor?.(s.id) ?? null}
                onTap={() => onFocus(s.id)}
                onRootPress={() => onRootPress?.(s.id)}
                onHold={s.id !== NO_PROJECT ? () => onHold?.(s.id) : undefined}
              />
            ))}
          </Animated.View>
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

function widthFor(i: number, focus: number, wideW: number): number {
  'worklet';
  const t = Math.max(0, 1 - Math.abs(focus - i));
  return THIN_W + (wideW - THIN_W) * t;
}

function BandCard({
  index,
  focus,
  wideW,
  cardH,
  name,
  sub,
  cover,
  bg,
  ink,
  ink2,
  rootName,
  onTap,
  onRootPress,
  onHold,
}: {
  index: number;
  focus: SharedValue<number>;
  wideW: number;
  cardH: number;
  name: string;
  sub: string;
  cover?: string;
  bg: string;
  ink: string;
  ink2: string;
  rootName: string | null;
  onTap: () => void;
  onRootPress: () => void;
  onHold?: () => void;
}) {
  const cardStyle = useAnimatedStyle(() => ({ width: widthFor(index, focus.value, wideW), height: cardH }));
  // The name lies flat on the front card and stands on the edge of a thin one, turning with the card's width (DeskSwitcher's own).
  const nameStyle = useAnimatedStyle(() => {
    const t = Math.max(0, 1 - Math.abs(focus.value - index));
    const w = widthFor(index, focus.value, wideW);
    const shut = (w + NAME_H) / 2;
    return {
      left: 18 + (1 - t) * (shut - 18),
      width: (cardH - 36) * (1 - t) + Math.max(0, w - 36) * t,
      transform: [{ rotate: `${-90 * (1 - t)}deg` }],
    };
  });
  const subStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - Math.abs(focus.value - index) * 2.2) }));
  const chipStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - Math.abs(focus.value - index) * 2.2) }));
  return (
    <Animated.View style={[styles.card, { backgroundColor: bg }, cardStyle]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onTap} onLongPress={onHold} delayLongPress={350} accessibilityLabel={name}>
        {!!cover && (
          <>
            {/* A fixed-width picture, centred: a thin card is a slit onto it. */}
            <View style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: wideW, marginLeft: -wideW / 2 }} pointerEvents="none">
              <Image source={{ uri: cover }} resizeMode="cover" style={StyleSheet.absoluteFill} />
            </View>
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.3)' }]} />
          </>
        )}
        {!!rootName && (
          <Animated.View style={[{ position: 'absolute', top: 14, left: 16 }, chipStyle]}>
            <Pressable onPress={onRootPress} hitSlop={8} accessibilityLabel="Папка-корінь проєкту" style={styles.rootChip}>
              <Text style={styles.rootChipText} numberOfLines={1}>
                папка «{rootName}» · змінити
              </Text>
            </Pressable>
          </Animated.View>
        )}
        <Animated.View style={[styles.nameBox, nameStyle]} pointerEvents="none">
          <Text numberOfLines={1} style={[styles.name, { color: ink }]}>
            {name}
          </Text>
        </Animated.View>
        <Animated.Text numberOfLines={1} style={[styles.sub, { color: ink2 }, subStyle]} pointerEvents="none">
          {sub}
        </Animated.Text>
      </Pressable>
    </Animated.View>
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
  card: { borderRadius: 26, overflow: 'hidden' },
  // A box of its own, anchored at the bottom-left: turned up, the name runs up the card's edge from there.
  nameBox: { position: 'absolute', left: 18, bottom: 40, transformOrigin: 'left bottom' } as never,
  name: { fontFamily: SOFT_SEMIBOLD, fontSize: 24, lineHeight: NAME_H, letterSpacing: -0.4 },
  sub: { position: 'absolute', left: 18, bottom: 16, right: 18, fontFamily: SOFT_MEDIUM, fontSize: 14 },
  rootChip: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.88)' },
  rootChipText: { fontSize: 12, color: '#3a3733', fontFamily: SOFT_MEDIUM },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, paddingTop: 12 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
