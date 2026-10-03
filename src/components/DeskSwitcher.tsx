import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { GlassPortal } from './GlassPortal';
import { useBlurTarget } from './GlassTarget';
import { Ionicons } from './icons/Ionicons';
import { TOP_NAV_H, topBarFrame } from './TopNavBar';
import { CHROME_TOP } from '../constants/rail';
import { useSoft } from '../theme/soft';
import { SOFT_SEMIBOLD } from '../utils/fonts';
import { deskPull } from '../navigation/deskPull';

type Live = Readonly<{ value: number }>;

// THE OPEN DESKS AS AN ACCORDION (the user's design, 2026-10-03, from a
// TikTok of "Animating Card Effect"): the bar morphs down into a panel in
// which every desk is a tall card standing where its icon stood - the open
// desk wide, the others narrow, each name horizontal when its card is open
// and turned up on its edge when it is shut. The one difference from the
// video: cards do not open on a TAP but as a finger SWIPES along the panel -
// the open card narrows exactly as much as the next one widens, so there is
// one number, `focus` (0..n-1, fractional while a finger is on it), and
// every card's width, its name's turn and its shade follow from how near it
// is to that number. Let go and it settles on the nearest desk, which is
// where the app goes; a tap on a card goes there and closes the panel.
export type SwitcherDesk = {
  key: string;
  label: string;
  icon: string;
  active: boolean;
  shot?: string;
  // Goes to the desk (does not close the panel).
  onGo: () => void;
  onClose?: () => void;
};

const PAD = 8;
const GAP = 6;
const MIN_NARROW = 38;
const MAX_NARROW = 76;
// What the bar's pills measure, where the morph starts.
const PILL_W = TOP_NAV_H - 12;
const PILL_OPEN_W = 96;
const START_LEFT = 56;
const OPEN_MS = 320;
// The name's line: what it takes across the card once turned up.
const NAME_H = 18;

function widthOf(i: number, focus: number, wide: number, narrow: number): number {
  'worklet';
  const t = Math.max(0, 1 - Math.abs(focus - i));
  return narrow + (wide - narrow) * t;
}

export default function DeskSwitcher({
  visible,
  desks,
  onDismiss,
}: {
  visible: boolean;
  desks: SwitcherDesk[];
  onDismiss: () => void;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const blurTarget = useBlurTarget();
  const n = desks.length;
  const startIndex = Math.max(0, desks.findIndex((d) => d.active));

  // 0 = the bar, 1 = the panel. It comes from two places: the PULL that
  // is dragging the bar down (deskPull, in step with the finger), and the
  // panel's own opening once it is held open or asked for (openM). It is
  // whichever is further along.
  const openM = useSharedValue(0);
  const morph = useDerivedValue(() => Math.max(deskPull.value, openM.value));
  // Drawn at all only while it is more than a bar - the blur under it is
  // live, and a live blur hidden by opacity still costs every frame.
  const [engaged, setEngaged] = useState(false);
  useAnimatedReaction(
    () => morph.value > 0.01,
    (now, before) => {
      if (now !== before) runOnJS(setEngaged)(now);
    }
  );
  // Which desk is open, fractional while a finger is on it.
  const focus = useSharedValue(startIndex);
  const focusAtStart = useSharedValue(startIndex);
  const lastGone = useRef(startIndex);
  const shown = useRef(false);

  // The geometry, from the bar's own frame.
  const frame = topBarFrame(width);
  const barTop = insets.top + CHROME_TOP;
  const panelH = Math.min(Math.round(height * 0.52), 470);
  const inner = frame.width - PAD * 2;
  const narrow =
    n > 1 ? Math.min(MAX_NARROW, Math.max(MIN_NARROW, (inner * 0.45 - n * GAP) / (n - 1))) : 0;
  const wide = n > 1 ? Math.max(140, inner - (n - 1) * (narrow + GAP)) : inner;
  // One desk's worth of finger travel: the width one card hands the next.
  const step = Math.max(70, wide - narrow + GAP);

  // The open desk is the one the panel starts on, whichever way it began.
  useEffect(() => {
    if (!engaged && !visible) {
      shown.current = false;
      return;
    }
    if (shown.current) return;
    shown.current = true;
    focus.value = startIndex;
    lastGone.current = startIndex;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engaged, visible]);
  // Held open or asked for: the panel finishes opening, from wherever the
  // pull had brought it.
  useEffect(() => {
    if (!visible) return;
    openM.value = deskPull.value > 0.9 ? 1 : withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Desks closed from inside it: the focus stays on a desk that exists.
  useEffect(() => {
    if (n > 0 && focus.value > n - 1) focus.value = n - 1;
  }, [n, focus]);

  const close = () => {
    cancelAnimation(openM);
    openM.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(onDismiss)();
    });
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  // Going to a desk, once per settle.
  const desksRef = useRef(desks);
  desksRef.current = desks;
  const goTo = (index: number) => {
    if (index === lastGone.current) return;
    lastGone.current = index;
    desksRef.current[index]?.onGo();
  };

  const scrub = useMemo(
    () =>
      Gesture.Pan()
        .enabled(visible)
        .activeOffsetX([-8, 8])
        .failOffsetY([-30, 30])
        .onBegin(() => {
          cancelAnimation(focus);
          focusAtStart.value = focus.value;
        })
        .onUpdate((e) => {
          // Swiping left brings the next card, as the pager does.
          focus.value = Math.min(n - 1, Math.max(0, focusAtStart.value - e.translationX / step));
        })
        .onEnd((e) => {
          const target = Math.min(n - 1, Math.max(0, Math.round(focus.value - e.velocityX / (step * 6))));
          focus.value = withTiming(target, { duration: 240, easing: Easing.out(Easing.cubic) });
          runOnJS(goTo)(target);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, step, visible]
  );

  const panelStyle = useAnimatedStyle(() => ({
    height: TOP_NAV_H + (panelH - TOP_NAV_H) * morph.value,
    borderRadius: TOP_NAV_H / 2 + (30 - TOP_NAV_H / 2) * morph.value,
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: morph.value }));
  // Where the cards stand: moved along when there are more than fit, so the
  // open one stays in view.
  const rowStyle = useAnimatedStyle(() => {
    let x = 0;
    let centre = 0;
    for (let i = 0; i < n; i++) {
      const w = widthOf(i, focus.value, wide, narrow);
      const t = Math.max(0, 1 - Math.abs(focus.value - i));
      centre += t * (x + w / 2);
      x += w + GAP;
    }
    const total = x - GAP;
    const shift = Math.max(0, Math.min(total - inner, centre - inner / 2));
    return {
      paddingLeft: START_LEFT + (PAD - START_LEFT) * morph.value,
      transform: [{ translateX: -shift * morph.value }],
    };
  });

  if (!visible && !engaged) return null;
  return (
    <GlassPortal priority={50}>
      <View style={styles.layer} pointerEvents={visible ? 'box-none' : 'none'}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]} pointerEvents="none">
          <BlurView
            intensity={40}
            tint={S.dark ? 'dark' : 'light'}
            blurMethod="dimezisBlurView"
            blurTarget={blurTarget ?? undefined}
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: S.dark ? 'rgba(0,0,0,0.4)' : 'rgba(30,30,28,0.16)' }]} />
        </Animated.View>
        {visible && <Pressable style={StyleSheet.absoluteFill} onPress={() => closeRef.current()} />}
        <Animated.View
          style={[
            styles.panel,
            { top: barTop, left: frame.left, width: frame.width, backgroundColor: S.chrome, boxShadow: S.popShadow },
            panelStyle,
          ]}
        >
          <GestureDetector gesture={scrub}>
            <View style={styles.clip} collapsable={false}>
              <Animated.View style={[styles.row, { paddingTop: 6 }, rowStyle]}>
                {desks.map((desk, i) => (
                  <Card
                    key={desk.key}
                    index={i}
                    desk={desk}
                    focus={focus}
                    morph={morph}
                    wide={wide}
                    narrow={narrow}
                    startWidth={i === startIndex ? PILL_OPEN_W : PILL_W}
                    bodyHeight={panelH - 6 - PAD}
                    onTap={() => {
                      focus.value = withTiming(i, { duration: 220, easing: Easing.out(Easing.cubic) });
                      goTo(i);
                      setTimeout(() => closeRef.current(), 160);
                    }}
                  />
                ))}
              </Animated.View>
            </View>
          </GestureDetector>
        </Animated.View>
      </View>
    </GlassPortal>
  );
}

function Card({
  index,
  desk,
  focus,
  morph,
  wide,
  narrow,
  startWidth,
  bodyHeight,
  onTap,
}: {
  index: number;
  desk: SwitcherDesk;
  focus: Live;
  morph: Live;
  wide: number;
  narrow: number;
  startWidth: number;
  bodyHeight: number;
  onTap: () => void;
}) {
  const S = useSoft();
  const cardStyle = useAnimatedStyle(() => {
    const w = widthOf(index, focus.value, wide, narrow);
    return {
      width: startWidth + (w - startWidth) * morph.value,
      height: TOP_NAV_H - 12 + (bodyHeight - (TOP_NAV_H - 12)) * morph.value,
    };
  });
  // Faces come in as the panel opens; what the bar showed (the icon on the
  // panel's own colour) goes as they do.
  const faceStyle = useAnimatedStyle(() => ({ opacity: morph.value }));
  const barIconStyle = useAnimatedStyle(() => ({ opacity: 1 - morph.value }));
  // The name: horizontal while the card is open, turned up on its edge as
  // it shuts - one angle, from how near the card is to the open one.
  const nameStyle = useAnimatedStyle(() => {
    const t = Math.max(0, 1 - Math.abs(focus.value - index));
    // The card's own width now, as the card is drawn.
    const w = startWidth + (widthOf(index, focus.value, wide, narrow) - startWidth) * morph.value;
    // Turned up (a quarter turn about its bottom-left corner), the name
    // stands to the LEFT of that corner by its own height: so where the
    // corner is put decides where it stands - 12 from the edge when the
    // card is open, and in the middle of the card when it is shut.
    const shut = (w + NAME_H) / 2;
    return {
      left: 12 + (1 - t) * (shut - 12),
      transform: [{ rotate: `${-90 * (1 - t)}deg` }],
      opacity: morph.value,
    };
  });
  const shadeStyle = useAnimatedStyle(() => {
    const t = Math.max(0, 1 - Math.abs(focus.value - index));
    return { opacity: 0.55 - 0.3 * t };
  });
  const closeStyle = useAnimatedStyle(() => {
    const t = Math.max(0, 1 - Math.abs(focus.value - index));
    return { opacity: t * morph.value };
  });
  return (
    <Animated.View style={[styles.card, { backgroundColor: S.ink }, cardStyle]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onTap} accessibilityLabel={desk.label}>
        {/* A fixed-width picture, centred: a narrow card is a slit onto it. */}
        <Animated.View style={[styles.picture, { width: wide, marginLeft: -wide / 2 }, faceStyle]} pointerEvents="none">
          {desk.shot ? (
            <Image source={{ uri: desk.shot }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.noShot]}>
              <Ionicons name={desk.icon as never} size={56} color="rgba(255,255,255,0.18)" />
            </View>
          )}
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, styles.shade, shadeStyle]} pointerEvents="none" />
        {/* On the bar this card is an icon on the capsule's own colour. */}
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: S.chrome }, barIconStyle]} pointerEvents="none" />
        <View style={styles.iconSpot} pointerEvents="none">
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, barIconStyle]}>
            <Ionicons name={desk.icon as never} size={20} color={S.ink} />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, faceStyle]}>
            <Ionicons name={desk.icon as never} size={20} color="#fff" />
          </Animated.View>
        </View>
        <Animated.View style={[styles.name, { width: bodyHeight - 24 }, nameStyle]} pointerEvents="none">
          <Text style={styles.nameText} numberOfLines={1}>
            {desk.label}
          </Text>
        </Animated.View>
      </Pressable>
      {desk.onClose && (
        <Animated.View style={[styles.closeSpot, closeStyle]}>
          <Pressable hitSlop={8} onPress={desk.onClose} accessibilityLabel="Закрити стіл" style={styles.close}>
            <Ionicons name="close" size={17} color="#fff" />
          </Pressable>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  panel: { position: 'absolute', overflow: 'hidden' },
  clip: { flex: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: GAP, alignItems: 'flex-start' },
  card: { borderRadius: 22, overflow: 'hidden' },
  picture: { position: 'absolute', top: 0, bottom: 0, left: '50%' },
  noShot: { alignItems: 'center', justifyContent: 'center' },
  shade: { backgroundColor: '#000' },
  iconSpot: { position: 'absolute', left: 8, top: 7, width: 20, height: 20 },
  center: { alignItems: 'center', justifyContent: 'center' },
  // Anchored at the bottom-left corner: turned up, the name runs up the
  // card's edge from there.
  // A long box of its own (the card's height): a name turned up must not be
  // cut to the card's WIDTH before it is turned.
  name: { position: 'absolute', left: 12, bottom: 12, transformOrigin: 'left bottom' } as never,
  nameText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: NAME_H,
    fontFamily: SOFT_SEMIBOLD,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  closeSpot: { position: 'absolute', right: 8, top: 5 },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
