import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { BackHandler } from 'react-native';
import { GlassPortal } from './GlassPortal';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { hapticSelectItem } from '../utils/haptics';
import { SOFT_SEMIBOLD } from '../utils/fonts';
import type { CreateKind } from '../utils/createItem';
import { registerFanDrag } from '../utils/fanDrag';

// THE «+» FAN (the user, 2026-10-10): three arcs of round buttons opening up
// and left from where the «+» stands, each with its name under it. Nearest
// arc - documents and boards and cards; the second - what the app keeps in
// its media bases; the third - the rest. Tap «+», tap a button; or press and
// slide - the fan is dealt by the first tap, the finger picks.
// The `into` hint on each says where it lands (folder + base, or base only).

export type FanItem = { key: CreateKind | 'folder' | 'project'; icon: string; label: string; into: 'both' | 'base' };

export const FAN_ARCS: FanItem[][] = [
  [
    { key: 'board', icon: 'easel-outline', label: 'Дошка', into: 'both' },
    { key: 'document', icon: 'document-text-outline', label: 'Документ', into: 'both' },
    { key: 'card', icon: 'albums-outline', label: 'Картка', into: 'both' },
  ],
  [
    { key: 'geo', icon: 'location-outline', label: 'Геоточка', into: 'both' },
    { key: 'link', icon: 'link-outline', label: 'Посилання', into: 'both' },
    { key: 'video', icon: 'videocam-outline', label: 'YouTube', into: 'both' },
    { key: 'photo', icon: 'image-outline', label: 'Зображення', into: 'both' },
    { key: 'file', icon: 'document-outline', label: 'Файл', into: 'both' },
  ],
];

const BUTTON = 46;
// Wide enough that neighbouring labels (74 pt) never touch: the spacing along
// an arc is radius x angle, and every arc is checked against that.
const RADII = [88, 156, 252];
// Degrees, from straight up to straight left: each arc's own span. The column
// straight above «+» is left free for the place's own buttons (a folder, a project).
const SPANS: [number, number][] = [[120, 172], [112, 178], [104, 178]];

// Where the i-th of n buttons of arc `ai` stands (top-left corner), around (cx, cy).
function placeOf(ai: number, i: number, n: number, cx: number, cy: number) {
  const [from, to] = SPANS[ai];
  const deg = from + (to - from) * (n > 1 ? i / (n - 1) : 0.5);
  const rad = (deg * Math.PI) / 180;
  return { x: cx + RADII[ai] * Math.cos(rad) - BUTTON / 2, y: cy - RADII[ai] * Math.sin(rad) - BUTTON / 2 };
}

export default function CreateFan({
  visible,
  right,
  bottom,
  extra,
  onPick,
  onChat,
  onClose,
}: {
  visible: boolean;
  // Where the «+» stands: its centre, in points from the right and bottom edges.
  right: number;
  bottom: number;
  // Buttons only this place has (a folder's «Папка», the page's «Проєкт»), put in the last arc.
  extra?: FanItem[];
  onPick: (key: FanItem['key']) => void;
  // Held on the «+»: the chat, from wherever the fan is (the dock does the same).
  onChat?: () => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const p = useSharedValue(0);
  // The second arc: shown as dashed outlines first, dealt when they are tapped.
  const p2 = useSharedValue(0);
  const [second, setSecond] = useState(false);
  const [mounted, setMounted] = useState(visible);
  // The parent zeroes right/bottom the moment it closes the fan; the buttons must
  // fold back into where the «+» WAS, so the last real anchor is kept here.
  const anchor = useRef({ right, bottom, extra });
  if (visible) anchor.current = { right, bottom, extra };
  useEffect(() => {
    if (visible) {
      setMounted(true);
      setSecond(false);
      p2.value = 0;
      p.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.back(1.4)) });
    } else if (mounted) {
      // Said to the JS thread from the animation's own: a plain setter called
      // from there is what killed the app on entering «Проєкти».
      p2.value = withTiming(0, { duration: 150 });
      p.value = withTiming(0, { duration: 150 }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // Arc 0: the place's own buttons (a folder, a project), small and close; arcs 1-2: what can be made.
  const a = anchor.current;
  const arcs: FanItem[][] = [a.extra ?? [], ...FAN_ARCS];
  const cx = W - a.right;
  const cy = H - a.bottom;
  // PRESS AND SLIDE: the button under the finger, found against the places the
  // buttons will stand (see useFanDrag). The latest values live in a ref so the
  // listener registered once never reads a stale fan.
  const [hot, setHot] = useState<string | null>(null);
  const live = useRef({ arcs, cx, cy, second, hot: null as string | null, onPick });
  live.current.arcs = arcs;
  live.current.cx = cx;
  live.current.cy = cy;
  live.current.second = second;
  live.current.onPick = onPick;
  function dealSecond() {
    if (live.current.second) return;
    live.current.second = true;
    setSecond(true);
    p2.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.back(1.3)) });
  }
  useEffect(() => {
    if (!visible) {
      live.current.hot = null;
      setHot(null);
      return;
    }
    return registerFanDrag({
      move(x, y) {
        const L = live.current;
        // Far out: the second arc is dealt by the finger, as a tap on its outlines would.
        if (Math.hypot(x - L.cx, y - L.cy) > (RADII[1] + RADII[2]) / 2 - 20) dealSecond();
        let best: string | null = null;
        let bestD = BUTTON * 0.85;
        L.arcs.forEach((arc, ai) => {
          if (ai === 2 && !L.second) return;
          arc.forEach((item, i) => {
            const pos = placeOf(ai, i, arc.length, L.cx, L.cy);
            const d = Math.hypot(x - (pos.x + BUTTON / 2), y - (pos.y + BUTTON / 2));
            if (d < bestD) {
              bestD = d;
              best = item.key;
            }
          });
        });
        if (best !== L.hot) {
          L.hot = best;
          if (best) hapticSelectItem();
          setHot(best);
        }
      },
      end() {
        const L = live.current;
        const picked = L.hot;
        L.hot = null;
        setHot(null);
        // Lifted over a button: that is the pick. Anywhere else the fan stays, as after a tap.
        if (picked) L.onPick(picked as FanItem['key']);
      },
    });
  }, [visible]);
  const hotItem = hot ? arcs.flat().find((it) => it.key === hot) : null;
  const dim = useAnimatedStyle(() => ({ opacity: p.value }));
  if (!mounted) return null;
  void insets;
  return (
    <GlassPortal priority={40}>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: S.dark ? 'rgba(0,0,0,0.78)' : 'rgba(246,245,242,0.93)' }, dim]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        {/* The first arc, always dealt; the second as dashed outlines that a tap fills. */}
        {arcs.map((arc, ai) =>
          arc.map((item, i) => {
            const n = arc.length;
            const { x, y } = placeOf(ai, i, n, cx, cy);
            if (ai === 2 && !second) {
              return (
                <Pressable
                  key={item.key}
                  onPress={() => {
                    hapticSelectItem();
                    setSecond(true);
                    p2.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.back(1.3)) });
                  }}
                  hitSlop={8}
                  style={[styles.ghost, { left: x, top: y, borderColor: S.ink3 }]}
                />
              );
            }
            return (
              <FanButton
                key={item.key}
                item={item}
                x={x}
                y={y}
                fromX={cx - BUTTON / 2}
                fromY={cy - BUTTON / 2}
                p={ai === 2 ? p2 : p}
                hot={hot === item.key}
                onPress={() => {
                  hapticSelectItem();
                  onPick(item.key);
                }}
              />
            );
          })
        )}
        {hotItem && (
          <View pointerEvents="none" style={[styles.hotLabel, { top: insets.top + 96 }]}>
            <Text style={[styles.hotTitle, { color: S.ink }]}>{hotItem.label}</Text>
            <Text style={[styles.hotSub, { color: S.ink3 }]}>{hotItem.into === 'both' ? 'у папку і в свою базу' : 'у свою базу'}</Text>
          </View>
        )}
        <Pressable
          onPress={onClose}
          onLongPress={() => {
            onClose();
            onChat?.();
          }}
          delayLongPress={450}
          style={[styles.close, { left: cx - 28, top: cy - 28, backgroundColor: S.ink }]}
          hitSlop={6}
        >
          <Ionicons name="close" size={26} color={S.card} />
        </Pressable>
      </View>
    </GlassPortal>
  );
}

function FanButton({
  item,
  x,
  y,
  fromX,
  fromY,
  p,
  hot,
  onPress,
}: {
  item: FanItem;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  p: { value: number };
  hot: boolean;
  onPress: () => void;
}) {
  const S = useSoft();
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withTiming(hot ? 1 : 0, { duration: 120 });
  }, [hot]);
  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    left: fromX + (x - fromX) * p.value,
    top: fromY + (y - fromY) * p.value,
    opacity: p.value,
    transform: [{ scale: (0.4 + 0.6 * p.value) * (1 + 0.3 * lift.value) }],
  }));
  return (
    <Animated.View style={[styles.item, style]}>
      <Pressable onPress={onPress} style={[styles.btn, { backgroundColor: S.card, boxShadow: S.popShadow }]}>
        <Ionicons name={item.icon as never} size={21} color={S.ink} />
        {item.into === 'both' && <View style={styles.dot} />}
      </Pressable>
      <Text style={[styles.label, { color: S.ink }]} numberOfLines={1}>
        {item.label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  item: { width: 74, marginLeft: -(74 - BUTTON) / 2, alignItems: 'center' },
  btn: { width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: 3, top: 3, width: 10, height: 10, borderRadius: 5, backgroundColor: '#4A7BD0', borderWidth: 2, borderColor: '#fff' },
  label: { fontSize: 10, fontFamily: SOFT_SEMIBOLD, marginTop: 3, width: 74, textAlign: 'center' },
  hotLabel: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  hotTitle: { fontSize: 22, fontFamily: SOFT_SEMIBOLD },
  hotSub: { fontSize: 13, marginTop: 2 },
  ghost: { position: 'absolute', width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, borderWidth: 1.5, borderStyle: 'dashed', opacity: 0.7 },
  close: { position: 'absolute', width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
