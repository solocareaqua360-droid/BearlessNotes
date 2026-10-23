import { ReactElement, ReactNode, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Ionicons } from './icons/Ionicons';
import type { SoftTokens } from '../theme/soft';
import type { DeskBead } from '../navigation/deskBeadsBus';
import { SOFT_REGULAR } from '../utils/fonts';
import { chromeCompact, useChromeCompactFlag } from '../navigation/chromeScroll';
import { setDockCarriesBack, useExtraDeskCount } from '../navigation/deskBeadsBus';
import { FEATURES } from '../features';

// THE DESK DOCK (2026-10-12, the user's sketch and words: «лупа відривається, як крапля, і приєднується до плюса»).
//
// ON THE THREE DESKS' OWN SCREENS: one white pill on the left with the three desks and, after a hairline, the
// search lens; on the right "+" and the multitasking circle. INSIDE (a folder, a base, a note's database): the old
// shape - one search field with "+" at its right end, and the way back as a circle.
//
// ONE number drives all of it, `p` (0 = on a desk, 1 = inside), and everything below is read off it, so the way in
// and the way out are the same motion run both ways:
//   0.00-0.20  the desks fade out of the pill, the pill pulls back, and the lens - riding a drop of its own - comes
//              away from its end and travels right, stretching as it goes;
//   0.26-0.40  the drop reaches "+": a white body appears round both, the drop sinks into it;
//   0.40-1.00  the body grows out to the LEFT, its left end carrying the lens, over the pill, which drains away;
//   0.78-1.00  the word «Пошук» (and the filter, where the base has one) comes in.
// The elements are laid out by `left`/`width` (not transforms), so a tap that drifts is still a tap - the stale
// measure trap of android_drawer_stale_measure.

const H = 56;
// THE RIGHT PAIR, EQUAL AND SMALLER (2026-10-12, the user's): "+" and the circle are both 48, 12 apart before the
// field takes the "+" in.
const BACK = 48;
const GAP = 12;
export const DESK_PLUS = 48;
const PLUS = DESK_PLUS;
const INSET = 4;
const PILL_H = 60;
const BEAD_W = 56;
const BEAD_H = 52;
const PILL_PAD = 4;
// The pill without its lens zone, and with it.
const PILL_CORE = 185;
const PILL_FULL = 237;
// The desks' capsule as drawn at rest - the note's dock capsule is the same width, so the two docks stand alike (2026-10-23).
export const DESK_PILL_W = PILL_FULL;
// The round button for the AI conversation: the same size as «+», 4 to its left.
export const DESK_ASSIST_GAP = 4;
const LENS_ZONE = PILL_FULL - PILL_CORE;
const LENS_ROOT = PILL_CORE + LENS_ZONE / 2 - 2;
const LENS_IN = 28;
// What the body holds when it first forms: the lens zone, then the "+" zone.
const BODY_START = 52 + INSET + PLUS + INSET;
const DURATION = 620;
const ease = (t: number) => {
  'worklet';
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
};
const easeInOut = (t: number) => {
  'worklet';
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};

// THE MICRO-MOTIONS (2026-10-16, plan SVhjNcAA4UwLf4wSzCXpNB, priority 1, the user's «беремось»):
//  - a button GROWS under the finger (~1.12) at the touch itself, and comes back on release with a slight overshoot -
//    the desks, the lens, "+" and the circle;
//  - the grey capsule of the current desk is a layer of its own under the beads: when another desk is picked its
//    LEADING edge springs there first and the trailing one follows a beat later - it stretches toward the new desk,
//    flows onto it and draws in, as a tab selection does on iOS (it used to jump).
// Calmer after the user's first try (2026-10-16: «занадто желейна... кулька трохи збільшується»): no overshoot
// anywhere, a smaller growth, and the capsule's two edges only a beat apart - it slides with a hint of stretch.
const GROW = 1.08;
const GROW_IN = { damping: 40, stiffness: 420 };
const GROW_OUT = { damping: 36, stiffness: 320 };
// The capsule's travel on a plain ease-out, not a spring (the user, second try: «розхитування в кінці... до мінімуму»):
// it slows into place and stops. While it travels it is as tall as the pill, and back to its own size on landing.
const CAP_LEAD_MS = 260;
const CAP_TRAIL_MS = 310;
const CAP_LAG = 30;
// The pill itself answers a touch anywhere on it: a hair bigger and lighter (the user's, same day).
const PILL_GROW = 1.06;
// Each desk draws a dock of its own, so the capsule would be born on the new desk with nothing to flow from: where it
// last stood is kept here, outside any one dock.
let lastDeskIndex = -1;
// THE CAPSULE STARTS AT THE TAP (2026-10-16, the user: «ривок» on switching desks). The new desk's page shows
// ~90 ms after the tap, and its dock with it - a capsule that set off only then sat still through that pause and
// then jumped into motion. Now the dock that is tapped starts the journey at once, and the dock of the new desk,
// born mid-way, takes the same journey up from where it has got to by then (by the clock), so it never restarts.
let capMotion: { from: number; to: number; at: number } | null = null;
const CAP_END = CAP_LAG + CAP_TRAIL_MS;
// Where the capsule is, `e` ms into a journey from one desk to another - ONE pure function of time, read on the UI
// thread by every dock, so a dock born mid-way draws exactly what the one before it would have (the user saw the
// hand-over as a «ривок» while the two docks eased by different curves).
function capAt(from: number, to: number, e: number) {
  'worklet';
  const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
  const aL = PILL_PAD + from * BEAD_W;
  const bL = PILL_PAD + to * BEAD_W;
  const right = to > from;
  const lead = ease(e / CAP_LEAD_MS);
  const trail = ease((e - CAP_LAG) / CAP_TRAIL_MS);
  const L = aL + (bL - aL) * (right ? trail : lead);
  const R = aL + BEAD_W + (bL - aL) * (right ? lead : trail);
  const H =
    e < 110
      ? BEAD_H + (PILL_H - BEAD_H) * (e / 110)
      : e < CAP_END - 150
        ? PILL_H
        : e < CAP_END
          ? PILL_H - (PILL_H - BEAD_H) * ((e - (CAP_END - 150)) / 150)
          : BEAD_H;
  return { L, R, H };
}
const capFresh = () => (capMotion && Date.now() - capMotion.at < CAP_END ? capMotion : null);
function useGrow() {
  const s = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return {
    style,
    s,
    on: () => {
      s.value = withSpring(GROW, GROW_IN);
    },
    off: () => {
      s.value = withSpring(1, GROW_OUT);
    },
  };
}
// Anything with a press of its own (the "+" the dock is handed): grows with the touch, whoever takes it.
function GrowOnTouch({ style, children }: { style: object; children: ReactNode }) {
  const g = useGrow();
  return (
    <Animated.View style={[style, g.style]} onTouchStart={g.on} onTouchEnd={g.off} onTouchCancel={g.off}>
      {children}
    </Animated.View>
  );
}
function DeskBeadButton({ d, i, soft, onPick }: { d: DeskBead; i: number; soft: SoftTokens; onPick: (i: number) => void }) {
  const g = useGrow();
  return (
    <Pressable
      onPress={() => {
        onPick(i);
        d.onPress();
      }}
      onPressIn={g.on}
      onPressOut={g.off}
      accessibilityLabel={d.label}
      style={[styles.bead, { left: PILL_PAD + i * BEAD_W, top: (PILL_H - BEAD_H) / 2, width: BEAD_W, height: BEAD_H }]}
    >
      <Animated.View style={g.style}>
        <Ionicons name={d.icon as keyof typeof Ionicons.glyphMap} size={24} color={soft.ink} />
      </Animated.View>
    </Pressable>
  );
}

export default function DeskDock({
  state,
  width,
  soft,
  desks,
  onSearch,
  onSearchLong,
  searchDisabled,
  searchIcon,
  searchLabel,
  plusEl,
  extraEl,
  rootExtraEl,
  multiIcon,
  onMulti,
  backIcon,
  onBack,
  circleBack,
}: {
  state: 'root' | 'inside';
  width: number;
  soft: SoftTokens;
  desks: DeskBead[];
  onSearch: () => void;
  onSearchLong?: () => void;
  searchDisabled?: boolean;
  searchIcon: ReactElement;
  searchLabel: string;
  plusEl: ReactElement;
  extraEl?: ReactElement | null;
  // ON A ROOT DESK, left of «+»: the AI conversation's round button (screens/AssistantScreen, 2026-10-22). Drawn only where
  // the room between the desks' pill and «+» holds it.
  rootExtraEl?: ReactElement | null;
  multiIcon: ReactElement;
  onMulti: () => void;
  backIcon: ReactElement;
  onBack: () => void;
  // INSIDE A BASE WITH THE DESKS (deskBeadsBus's useDockDesksHere): the desk pill stays, and the circle is the way
  // back - not multitasking.
  circleBack?: boolean;
}) {
  const surface = { backgroundColor: soft.chrome, boxShadow: soft.shadow };
  const xr = width - BACK - GAP;
  const plusLeft = xr - INSET - PLUS;
  const extraLeft = plusLeft - INSET - PLUS;
  const rightZone = (extraEl ? PLUS + INSET : 0) + INSET + PLUS + INSET;
  // The bar at the top drops its own back button while this dock is up (it is the circle at the right end).
  useEffect(() => {
    setDockCarriesBack(true);
    return () => setDockCarriesBack(false);
  }, []);
  const extraDesks = Math.min(useExtraDeskCount(), 5);
  // The current desk's capsule: its two edges, each on its own spring.
  const activeIndex = desks.findIndex((d) => d.active);
  // The capsule is a journey (from, to) and a clock (ms into it); at rest from === to and the clock stands at its end.
  const born = (() => {
    const m = capFresh();
    if (m) return { from: m.from, to: m.to, t: Date.now() - m.at };
    const i = lastDeskIndex >= 0 && lastDeskIndex < desks.length ? lastDeskIndex : Math.max(0, activeIndex);
    return { from: i, to: i, t: CAP_END };
  })();
  const capFrom = useSharedValue(born.from);
  const capTo = useSharedValue(born.to);
  const capT = useSharedValue(born.t);
  // The journey this dock is already running - never restarted: the same dock lives on through the hand-over now, and a
  // restart by the JS clock pulled the capsule back ~40 px (the UI's run had started later than the tap).
  const running = useRef<string | null>(born.t < CAP_END ? `${born.from}>${born.to}` : null);
  const runCapsule = (from: number, to: number, e: number) => {
    running.current = `${from}>${to}`;
    capFrom.value = from;
    capTo.value = to;
    capT.value = e;
    capT.value = withTiming(CAP_END, { duration: Math.max(0, CAP_END - e), easing: Easing.linear });
  };
  // A desk tapped on THIS dock: off at once.
  const pick = (i: number) => {
    const from = lastDeskIndex >= 0 ? lastDeskIndex : activeIndex;
    if (from < 0 || i === from) return;
    capMotion = { from, to: i, at: Date.now() };
    lastDeskIndex = i;
    runCapsule(from, i, 0);
  };
  const capShown = useRef(lastDeskIndex >= 0);
  useEffect(() => {
    if (activeIndex < 0) return;
    const m = capFresh();
    if (m && m.to === activeIndex) {
      // The journey a tap began (on this dock or the one before): carry on from where it is - unless it is this very
      // dock that is running it.
      lastDeskIndex = activeIndex;
      capShown.current = true;
      if (running.current !== `${m.from}>${m.to}`) runCapsule(m.from, m.to, Date.now() - m.at);
      return;
    }
    const from = lastDeskIndex;
    lastDeskIndex = activeIndex;
    if (!capShown.current || from < 0 || from === activeIndex || from >= desks.length) {
      capShown.current = true;
      running.current = null;
      capFrom.value = activeIndex;
      capTo.value = activeIndex;
      capT.value = CAP_END;
      return;
    }
    // Reached another way (a swipe between desks): the whole journey from here.
    capMotion = { from, to: activeIndex, at: Date.now() };
    runCapsule(from, activeIndex, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);
  const capStyle = useAnimatedStyle(() => {
    const c = capAt(capFrom.value, capTo.value, capT.value);
    return { left: c.L, width: Math.max(0, c.R - c.L), top: (PILL_H - c.H) / 2, height: c.H, borderRadius: c.H / 2 };
  });
  const lensGrow = useGrow();
  // The pill's own answer to a touch: 0 at rest, 1 held.
  const pillTouch = useSharedValue(0);
  const pillPressStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + (PILL_GROW - 1) * pillTouch.value }] }));
  const pillGlowStyle = useAnimatedStyle(() => ({ opacity: 0.35 * pillTouch.value }));
  const pillOn = () => {
    pillTouch.value = withSpring(1, GROW_IN);
  };
  const pillOff = () => {
    pillTouch.value = withSpring(0, GROW_OUT);
  };
  const circleGrow = useGrow();
  const p = useSharedValue(state === 'root' ? 0 : 1);
  useEffect(() => {
    p.value = withTiming(state === 'root' ? 0 : 1, { duration: DURATION, easing: Easing.bezier(0.33, 0, 0.2, 1) });
  }, [state, p]);
  // What the circle is: 0 multitasking, 1 back - with `p` everywhere but inside a base that keeps the desks.
  const backOnCircle = state !== 'root' || !!circleBack;
  const q = useSharedValue(backOnCircle ? 1 : 0);
  useEffect(() => {
    q.value = withTiming(backOnCircle ? 1 : 0, { duration: DURATION, easing: Easing.bezier(0.33, 0, 0.2, 1) });
  }, [backOnCircle, q]);

  // The body's width, as a worklet: both the body and the lens that rides its left end read it.
  const bodyWidth = (v: number) => {
    'worklet';
    return BODY_START + (xr - BODY_START) * ease((v - 0.4) / 0.6);
  };
  // The lens's centre: along the drop's flight to the "+", then on the body's left end.
  const lensX = (v: number) => {
    'worklet';
    if (v < 0.4) {
      const to = xr - BODY_START + 28;
      return LENS_ROOT + (to - LENS_ROOT) * easeInOut(v / 0.4);
    }
    return xr - bodyWidth(v) + LENS_IN;
  };

  const pillStyle = useAnimatedStyle(() => ({
    width: interpolate(p.value, [0, 0.12, 0.4, 0.85], [PILL_FULL, PILL_CORE, PILL_CORE, 0], Extrapolation.CLAMP),
    opacity: interpolate(p.value, [0.5, 0.85], [1, 0], Extrapolation.CLAMP),
  }));
  const dropStyle = useAnimatedStyle(() => {
    const x = lensX(p.value);
    const phase = Math.min(1, p.value / 0.4);
    const w = 52 + 16 * Math.sin(Math.PI * phase);
    return {
      left: x - w / 2,
      width: w,
      opacity: interpolate(p.value, [0.38, 0.46], [1, 0], Extrapolation.CLAMP),
    };
  });
  const lensStyle = useAnimatedStyle(() => {
    const x = lensX(p.value);
    return { left: x - 14, transform: [{ rotate: `${(x - LENS_ROOT) * (360 / (LENS_IN - LENS_ROOT))}deg` }, { scale: lensGrow.s.value }] };
  });
  const bodyStyle = useAnimatedStyle(() => {
    const w = bodyWidth(p.value);
    return { left: xr - w, width: w, opacity: interpolate(p.value, [0.26, 0.4], [0, 1], Extrapolation.CLAMP) };
  });
  const wordStyle = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.78, 1], [0, 1], Extrapolation.CLAMP) }));
  // Without the switcher the circle is only the way back: it simply comes in (fades up, grows a little) with the arrow
  // already in place - no turning out of a multitasking sign that is no longer there (the user, 2026-10-23).
  const circleShown = useAnimatedStyle(() => ({ opacity: q.value, transform: [{ scale: 0.85 + 0.15 * q.value }] }));
  const multiStyle = useAnimatedStyle(() => ({
    opacity: interpolate(q.value, [0.3, 0.6], [1, 0], Extrapolation.CLAMP),
    transform: [{ rotate: `${-90 * ease(q.value / 0.8)}deg` }],
  }));
  const switcherOn = FEATURES.deskSwitcher;
  const backStyle = useAnimatedStyle(() =>
    switcherOn
      ? {
          opacity: interpolate(q.value, [0.4, 0.7], [0, 1], Extrapolation.CLAMP),
          transform: [{ rotate: `${90 * (1 - ease(q.value / 0.8))}deg` }],
        }
      : { opacity: 1, transform: [{ rotate: '0deg' }] }
  );
  const beadsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.02, 0.2], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(p.value, [0.02, 0.2], [1, 0.75], Extrapolation.CLAMP) }],
  }));

  // THE CHROME STEPS BACK WHILE A LIST IS READ (features.chromeCompact): the left half - the desks and the search
  // - goes, the right pair ("+" and its circle) stays at half strength.
  const compactOn = useChromeCompactFlag() && FEATURES.chromeCompact;
  const leftCompact = useAnimatedStyle(() => ({ opacity: 1 - chromeCompact.value }));
  const rightCompact = useAnimatedStyle(() => ({ opacity: 1 - 0.3 * chromeCompact.value }));
  const root = state === 'root';
  return (
    <View style={{ width, height: H }} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, leftCompact]} pointerEvents={compactOn ? 'none' : 'box-none'}>
      {/* The drop the lens rides: it starts UNDER the pill's end, comes away from it and goes to the "+". */}
      <Animated.View
        pointerEvents="none"
        style={[styles.drop, surface, { top: (H - 52) / 2, height: 52, borderRadius: 26 }, dropStyle]}
      />
      {/* The pill, with the desks in it. */}
      <Animated.View
        pointerEvents={root ? 'box-none' : 'none'}
        onTouchStart={pillOn}
        onTouchEnd={pillOff}
        onTouchCancel={pillOff}
        style={[styles.pill, surface, { top: (H - PILL_H) / 2, height: PILL_H, borderRadius: PILL_H / 2 }, pillStyle, pillPressStyle]}
      >
        {/* Lighter while touched: a white veil over the pill's own surface (shows on the dark theme; on the light one
            the pill is white already and only grows). */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF' }, pillGlowStyle]} />
        <Animated.View style={[styles.beads, beadsStyle]} pointerEvents={root ? 'box-none' : 'none'}>
          {activeIndex >= 0 && (
            <Animated.View
              pointerEvents="none"
              style={[styles.capsule, { backgroundColor: soft.fillSolid }, capStyle]}
            />
          )}
          {desks.map((d, i) => (
            <DeskBeadButton key={d.key} d={d} i={i} soft={soft} onPick={pick} />
          ))}
          <View style={[styles.hairline, { left: PILL_PAD + desks.length * BEAD_W + 4, backgroundColor: soft.line }]} />
        </Animated.View>
      </Animated.View>
      {/* The body that forms round the "+" and grows to the left - the search field. */}
      <Animated.View pointerEvents="none" style={[styles.body, surface, { height: H, borderRadius: H / 2 }, bodyStyle]} />
      {/* Inside: the search field is a tap target across the body, up to the buttons at its end. */}
      {!root && (
        <Pressable
          onPress={onSearch}
          onLongPress={onSearchLong}
          disabled={searchDisabled}
          accessibilityLabel={searchLabel}
          style={[styles.searchHit, { right: width - xr + rightZone, height: H }]}
        >
          <Animated.Text style={[styles.word, { color: soft.ink3 }, wordStyle]} numberOfLines={1}>
            {searchLabel}
          </Animated.Text>
        </Pressable>
      )}
      {/* On a desk: the lens is its own button, at the pill's end. */}
      {root && (
        <Pressable
          onPress={onSearch}
          onLongPress={onSearchLong}
          onPressIn={() => {
            lensGrow.on();
            pillOn();
          }}
          onPressOut={() => {
            lensGrow.off();
            pillOff();
          }}
          disabled={searchDisabled}
          accessibilityLabel={searchLabel}
          style={{ position: 'absolute', left: PILL_CORE, top: (H - PILL_H) / 2, width: LENS_ZONE, height: PILL_H }}
        />
      )}
      {extraEl && !root && <Animated.View style={[styles.slot, { left: extraLeft, top: (H - PLUS) / 2 }, wordStyle]}>{extraEl}</Animated.View>}
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, rightCompact]} pointerEvents="box-none" needsOffscreenAlphaCompositing>
      {/* "+": where it stands it never moves - the pill's drop travels to it, and the field grows round it. */}
      <GrowOnTouch style={[styles.slot, { left: plusLeft, top: (H - PLUS) / 2 }]}>{plusEl}</GrowOnTouch>
      {rootExtraEl && root && extraLeft >= PILL_FULL + 8 && (
        <GrowOnTouch style={[styles.slot, { left: extraLeft, top: (H - PLUS) / 2 }]}>{rootExtraEl}</GrowOnTouch>
      )}
      {/* The circle at the far end: multitasking on a desk, the way back inside. Without the switcher (FEATURES.deskSwitcher
          off, 2026-10-23) a root desk has no circle - an empty place - and it comes in only as the way back. */}
      <Animated.View
        pointerEvents={!FEATURES.deskSwitcher && !backOnCircle ? 'none' : 'auto'}
        style={[styles.circleWrap, { left: width - BACK, top: (H - BACK) / 2, width: BACK, height: BACK }, circleGrow.style, !FEATURES.deskSwitcher && circleShown]}
      >
      <Pressable
        onPress={backOnCircle ? onBack : onMulti}
        onPressIn={circleGrow.on}
        onPressOut={circleGrow.off}
        accessibilityLabel={backOnCircle ? 'Назад' : 'Відкриті вкладки'}
        hitSlop={6}
        style={[styles.circle, surface, { left: 0, top: 0, width: BACK, height: BACK, borderRadius: BACK / 2 }]}
      >
        {FEATURES.deskSwitcher && (
          <Animated.View style={[styles.icon, multiStyle]} pointerEvents="none">
            {multiIcon}
          </Animated.View>
        )}
        <Animated.View style={[styles.icon, backStyle]} pointerEvents="none">
          {backIcon}
        </Animated.View>
        {/* The open desks beyond the three, one small orange dot each, under the multitasking sign. */}
        {extraDesks > 0 && !backOnCircle && (
          <Animated.View style={[styles.dots, multiStyle]} pointerEvents="none">
            {Array.from({ length: extraDesks }, (_, i) => (
              <View key={i} style={[styles.dot, { backgroundColor: soft.accent }]} />
            ))}
          </Animated.View>
        )}
      </Pressable>
      </Animated.View>
      </Animated.View>
      {/* The lens itself, above everything: it rolls as it travels. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, leftCompact]}>
        <Animated.View pointerEvents="none" style={[styles.lens, { top: (H - 28) / 2 }, lensStyle]}>
          {searchIcon}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { position: 'absolute', left: 0, overflow: 'hidden' },
  beads: { position: 'absolute', left: 0, top: 0, bottom: 0, width: PILL_CORE },
  bead: { position: 'absolute', borderRadius: BEAD_H / 2, alignItems: 'center', justifyContent: 'center' },
  capsule: { position: 'absolute', borderRadius: BEAD_H / 2 },
  circleWrap: { position: 'absolute' },
  hairline: { position: 'absolute', top: (PILL_H - 26) / 2, width: 1, height: 26 },
  drop: { position: 'absolute' },
  body: { position: 'absolute', top: 0 },
  searchHit: { position: 'absolute', left: 0, flexDirection: 'row', alignItems: 'center', paddingLeft: LENS_IN + 10 + 10 },
  word: { flex: 1, fontSize: 15, fontFamily: SOFT_REGULAR },
  slot: { position: 'absolute', width: PLUS, height: PLUS },
  circle: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  icon: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  dots: { position: 'absolute', bottom: 6, flexDirection: 'row', gap: 3 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  lens: { position: 'absolute', width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});
