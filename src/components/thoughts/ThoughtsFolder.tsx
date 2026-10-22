import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { runOnJS, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { NavigationContext } from '@react-navigation/native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSoft } from '../../theme/soft';
import { FEATURES } from '../../features';
import { SOFT_BOLD, SOFT_SEMIBOLD } from '../../utils/fonts';
import { hueOf, useThoughts } from '../../hooks/useThoughts';
import { openThoughtCapture, openThoughtsSpace } from '../../utils/thoughtBus';
import { hapticPickUp } from '../../utils/haptics';
import { holdAmbient, holdMotion, onListMoved, releaseAmbient } from '../../utils/motionHold';
import { cloudDiameter, layoutClouds } from './ThemeClouds';
import ThoughtBalloon from './ThoughtBalloon';

// THE LIVING FOLDER (2026-10-15, sketch 2, liked): «Думки» on the explorer's first level, a little bigger than a
// folder, with the freshest themes drifting in it as small clouds - a presence to notice from the corner of the eye,
// never a reminder. A tap opens the space of themes; a hold catches a new thought (the clipboard's text one tap away).
const HEIGHT = 168;
const SHOWN = 5;

// Focus, where there is a screen to have it: the Mac's start page draws this folder outside any screen, where
// useIsFocused would throw - there it simply counts as in view.
function useFocusedIfScreen() {
  const nav = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => (nav ? nav.isFocused() : true));
  useEffect(() => {
    if (!nav) return;
    const on = nav.addListener('focus', () => setFocused(true));
    const off = nav.addListener('blur', () => setFocused(false));
    return () => {
      on();
      off();
    };
  }, [nav]);
  return focused;
}

// `late`: the card stands at once (shadow, name, count) but its balloons - and their rise - come ~450 ms later, after whatever swipe
// brought it on screen has settled (the projects band, 2026-10-22). An empty card of its own that popped in whole was worse.
export default function ThoughtsFolder({ late = false }: { late?: boolean } = {}) {
  const S = useSoft();
  const { themes, countOf, loaded } = useThoughts(true);
  const [w, setW] = useState(0);
  const fresh = useMemo(() => [...themes].sort((a, b) => b.touchedAt - a.touchedAt).slice(0, SHOWN), [themes]);
  const loose = countOf(null);
  // Balloons: laid out a little higher than the clouds were, to leave their strings room above the name.
  const places = useMemo(
    () => (w > 0 ? layoutClouds(fresh.map((t) => ({ id: t.id, d: cloudDiameter(countOf(t.id), true) })), w - 24, HEIGHT - 76, 10).map((p) => ({ ...p, x: p.x + 12, y: p.y + 6 })) : []),
    [fresh, countOf, w]
  );
  // THE BALLOONS FLY IN ONCE - when the folder first appears. Swiped to another desk and back, they do not rise again
  // (2026-10-15, the user's: «при прогортанні столів вже можна не підіймати їх з-за екрану, але зроби легку
  // інерційність - биття о бокову стінку і один одного, і ставання на місце»).
  const focused = useFocusedIfScreen();
  const [launch, setLaunch] = useState(0);
  const [show, setShow] = useState(!late);
  useEffect(() => {
    if (!late) return;
    const t = setTimeout(() => setShow(true), 450);
    return () => clearTimeout(t);
  }, [late]);
  // THE LITTLE PHYSICS: each balloon's push from its place and its speed. A swipe gives them all a sideways shove -
  // the desk moves, they lag behind like light things in a box; they meet the side wall and each other (soft, a third
  // of the speed kept) and a gentle spring draws each back to its place, damped near critical: no swinging to and fro.
  const nudge = useSharedValue<{ x: number; y: number; vx: number; vy: number }[]>([]);
  const homes = useSharedValue<{ x: number; y: number; r: number }[]>([]);
  const width = useSharedValue(0);
  useEffect(() => {
    homes.value = places.map((p) => ({ x: p.x, y: p.y, r: p.d / 2 }));
    nudge.value = places.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 }));
    width.value = w;
  }, [places, w, homes, nudge, width]);
  // The frame callback stops itself when all is still - from JS, where its handle lives.
  const physicsRef = useRef<{ setActive: (on: boolean) => void } | null>(null);
  const sleep = () => physicsRef.current?.setActive(false);
  const physics = useFrameCallback((frame) => {
    'worklet';
    const dt = Math.min(frame.timeSincePreviousFrame ?? 16, 32) / 1000;
    const hs = homes.value;
    const bs = nudge.value.map((b) => ({ ...b }));
    if (!hs.length || bs.length !== hs.length) return;
    const K = 26; // spring back to the place
    const C = 2 * 0.9 * Math.sqrt(K); // damping, a hair under critical
    const WALL = 0.35; // speed kept off a wall
    const MEET = 0.4; // ... and off another balloon
    let moving = 0;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      b.vx += (-K * b.x - C * b.vx) * dt;
      b.vy += (-K * b.y - C * b.vy) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // The side walls (6 in from the card's edges) and the top.
      const left = hs[i].x + b.x - hs[i].r;
      const right = hs[i].x + b.x + hs[i].r;
      if (left < 6) {
        b.x += 6 - left;
        if (b.vx < 0) b.vx = -b.vx * WALL;
      } else if (right > width.value - 6) {
        b.x -= right - (width.value - 6);
        if (b.vx > 0) b.vx = -b.vx * WALL;
      }
      const top = hs[i].y + b.y - hs[i].r * 1.1;
      if (top < 4) {
        b.y += 4 - top;
        if (b.vy < 0) b.vy = -b.vy * WALL;
      }
    }
    // Balloons meeting: pushed apart along the line between them, the closing speed turned round and softened.
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const dx = hs[i].x + bs[i].x - (hs[j].x + bs[j].x);
        const dy = hs[i].y + bs[i].y - (hs[j].y + bs[j].y);
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const min = hs[i].r + hs[j].r + 2;
        if (dist >= min) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const push = (min - dist) / 2;
        bs[i].x += nx * push;
        bs[i].y += ny * push;
        bs[j].x -= nx * push;
        bs[j].y -= ny * push;
        const closing = (bs[i].vx - bs[j].vx) * nx + (bs[i].vy - bs[j].vy) * ny;
        if (closing < 0) {
          const k = (-(1 + MEET) * closing) / 2;
          bs[i].vx += k * nx;
          bs[i].vy += k * ny;
          bs[j].vx -= k * nx;
          bs[j].vy -= k * ny;
        }
      }
    }
    for (const b of bs) moving += Math.abs(b.x) + Math.abs(b.y) + Math.abs(b.vx) * 0.05 + Math.abs(b.vy) * 0.05;
    nudge.value = bs;
    if (moving < 0.3) {
      nudge.value = bs.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 }));
      runOnJS(sleep)();
    }
  }, false);
  physicsRef.current = physics;
  // Start is the first desk: leaving it the desk slides away to the left, so the balloons lag to the right; coming
  // back it slides in from the left... they lag to the left. Each a little differently, so they meet.
  const shove = (dir: 1 | -1) => {
    nudge.value = nudge.value.map((b, i) => ({
      ...b,
      vx: b.vx + dir * (520 + ((i * 37) % 5) * 60),
      vy: b.vy + (((i * 53) % 7) - 3) * 22,
    }));
    physics.setActive(true);
  };
  const seen = useRef(false);
  // THE FIRST RISE WAITS FOR A CALM APP (2026-10-15, the user's: «перед тим як кульки піднімуться вгору у них буде 2
  // рази гальмування»). Just after the app opens it is still loading and drawing the whole desk, and a rise started
  // then stalls with it. So the first launch waits until the JS thread has been calm for a few ticks running (a 50 ms
  // timer that comes back on time), at most 2.5 s.
  const calm = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A scroll stills the balloons (ThoughtBalloon), so their breathing no longer needs the warm-up kept away.
  useEffect(() => onListMoved(releaseAmbient), []);
  useEffect(() => () => {
    if (calm.current) clearTimeout(calm.current);
  }, []);
  const launchWhenCalm = () => {
    // Held from the start too: the warm-up must not begin in the wait and still be going when they set off.
    holdMotion(2600);
    const started = Date.now();
    let quiet = 0;
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      quiet = now - last < 75 ? quiet + 1 : 0;
      last = now;
      if (quiet >= 4 || now - started > 2500) {
        calm.current = null;
        // The rise (the last balloon's climb and settle) keeps the heavy background work away (utils/motionHold).
        holdMotion(3600);
        // ... and the breathing after it (five slow half-breaths) keeps the cover warm-up away; a scroll ends it.
        holdAmbient(3600 + 22000);
        setLaunch((n) => n + 1);
      } else calm.current = setTimeout(tick, 50);
    };
    calm.current = setTimeout(tick, 50);
  };
  useEffect(() => {
    if (!show) return;
    if (focused && !seen.current) {
      seen.current = true;
      launchWhenCalm();
      return;
    }
    if (seen.current) shove(focused ? -1 : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, show]);
  return (
    <Pressable
      onPress={() => openThoughtsSpace()}
      onLongPress={() => {
        hapticPickUp();
        openThoughtCapture({});
      }}
      delayLongPress={350}
      onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}
      style={[styles.card, { backgroundColor: S.dark ? S.card : FEATURES.ourTones ? '#EFE9DE' : '#FFFDF8', boxShadow: S.popShadow }]}
      accessibilityLabel="Думки"
    >
      {show && places.map((p, i) => {
        const t = fresh.find((x) => x.id === p.id)!;
        return (
          <ThoughtBalloon
            key={p.id}
            place={p}
            look={hueOf(t, S.dark)}
            label={t.name}
            beat={i}
            launch={launch}
            index={i}
            nudge={nudge}
            from={HEIGHT - (p.y - p.d * 0.55) + 6}
            faded={Date.now() - t.touchedAt > 21 * 86400000}
          />
        );
      })}
      {loaded && fresh.length === 0 && (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: S.ink3 }]}>Затисни, щоб зловити першу думку</Text>
        </View>
      )}
      <View style={styles.foot} pointerEvents="none">
        <Text style={[styles.title, { color: S.ink }]}>Думки</Text>
        {loose > 0 && <Text style={styles.loose}>{`не розкладено ${loose}`}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { height: HEIGHT, borderRadius: 26, overflow: 'hidden', marginBottom: 14 },
  foot: { position: 'absolute', left: 18, right: 18, bottom: 12, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontSize: 21, fontFamily: SOFT_BOLD },
  loose: { fontSize: 13, fontFamily: SOFT_SEMIBOLD, color: '#9A5A1E' },
  empty: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingBottom: 30 },
  emptyText: { fontSize: 14, fontFamily: SOFT_SEMIBOLD },
});
