import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSoft } from '../../theme/soft';
import { FEATURES } from '../../features';
import { SOFT_BOLD, SOFT_SEMIBOLD } from '../../utils/fonts';
import { hueOf, useThoughts } from '../../hooks/useThoughts';
import { openThoughtCapture, openThoughtsSpace } from '../../utils/thoughtBus';
import { hapticPickUp } from '../../utils/haptics';
import { onListMoved } from '../../utils/motionHold';

// «ДУМКИ» AS A SQUARE (2026-10-25, sketch XCmYdqyLVpvVDxGWqyVm8b, the user's «так супер»): the size of a square folder, the
// freshest themes as plain circles - no names, no strings - drifting slowly and bouncing off the walls and one another,
// never trying to break out of the cage («кульки не намагаються вирватись з клітки»). Stilled while the list scrolls (the
// scroll gets every frame), they set off again a moment after it stops. A tap opens the space of themes, a hold catches a
// new thought - as the wide card did (ThoughtsFolder).
const SHOWN = 6;
const CRUISE = 14; // px per second
const TITLE_ROOM = 58; // the name and the count at the foot: the circles bounce off this «floor»

type Ball = { x: number; y: number; vx: number; vy: number; d: number };

// `height`: as tall as the two folders beside it (the user: a square made them «непропорційно широкими») - a rectangle.
export default function ThoughtsSquare({ size, height }: { size: number; height?: number }) {
  const tall = height ?? size;
  const S = useSoft();
  const { themes, countOf, loaded } = useThoughts(true);
  const fresh = useMemo(() => [...themes].sort((a, b) => b.touchedAt - a.touchedAt).slice(0, SHOWN), [themes]);
  const loose = countOf(null);
  // A circle's size grows a little with how much its theme holds.
  const diameters = useMemo(() => fresh.map((t) => Math.round(Math.min(46, 22 + 4 * Math.sqrt(countOf(t.id))))), [fresh, countOf]);
  const balls = useSharedValue<Ball[]>([]);
  const room = useSharedValue({ w: size, h: tall - TITLE_ROOM });
  useEffect(() => {
    room.value = { w: size, h: tall - TITLE_ROOM };
    balls.value = diameters.map((d, i) => ({
      d,
      x: 10 + ((i * 41) % Math.max(1, size - d - 20)),
      y: 8 + ((i * 29) % Math.max(1, tall - TITLE_ROOM - d - 16)),
      vx: (i % 2 ? 1 : -1) * (9 + i * 2),
      vy: (i % 3 ? 1 : -1) * (7 + i * 1.6),
    }));
  }, [diameters, size, tall, balls, room]);
  const frame = useFrameCallback((f) => {
    'worklet';
    const dt = Math.min(f.timeSincePreviousFrame ?? 16, 40) / 1000;
    const { w, h } = room.value;
    const bs = balls.value.map((b) => ({ ...b }));
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1;
      if (sp > CRUISE) {
        const k = 1 - Math.min(1, dt * 1.2);
        const m = k + ((1 - k) * CRUISE) / sp;
        b.vx *= m;
        b.vy *= m;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < 6) {
        b.x = 6;
        b.vx = Math.abs(b.vx);
      } else if (b.x + b.d > w - 6) {
        b.x = w - 6 - b.d;
        b.vx = -Math.abs(b.vx);
      }
      if (b.y < 6) {
        b.y = 6;
        b.vy = Math.abs(b.vy);
      } else if (b.y + b.d > h) {
        b.y = h - b.d;
        b.vy = -Math.abs(b.vy);
      }
    }
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i];
        const c = bs[j];
        const dx = c.x + c.d / 2 - (a.x + a.d / 2);
        const dy = c.y + c.d / 2 - (a.y + a.d / 2);
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const min = (a.d + c.d) / 2;
        if (dist >= min) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const push = (min - dist) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        c.x += nx * push;
        c.y += ny * push;
        const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (rel < 0) {
          a.vx += rel * nx;
          a.vy += rel * ny;
          c.vx -= rel * nx;
          c.vy -= rel * ny;
        }
      }
    }
    balls.value = bs;
  }, true);
  // Still while the list scrolls; off again 700 ms after the last move.
  const resume = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const off = onListMoved(() => {
      frame.setActive(false);
      if (resume.current) clearTimeout(resume.current);
      resume.current = setTimeout(() => frame.setActive(true), 700);
    });
    return () => {
      off();
      if (resume.current) clearTimeout(resume.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Pressable
      onPress={() => openThoughtsSpace()}
      onLongPress={() => {
        hapticPickUp();
        openThoughtCapture({});
      }}
      delayLongPress={350}
      accessibilityLabel="Думки"
      style={[styles.card, { width: size, height: tall, backgroundColor: S.dark ? S.card : FEATURES.ourTones ? '#EFE9DE' : '#FFFDF8', boxShadow: S.popShadow } as never]}
    >
      {fresh.map((t, i) => (
        <Circle key={t.id} index={i} balls={balls} color={hueOf(t, S.dark).to} />
      ))}
      {loaded && fresh.length === 0 && (
        <View style={styles.empty} pointerEvents="none">
          <Text style={[styles.emptyText, { color: S.ink3 }]}>Затисни, щоб зловити думку</Text>
        </View>
      )}
      <View style={styles.foot} pointerEvents="none">
        <Text style={[styles.title, { color: S.ink }]}>Думки</Text>
        {loose > 0 && <Text style={styles.loose}>{`не розкладено ${loose}`}</Text>}
      </View>
    </Pressable>
  );
}

function Circle({ index, balls, color }: { index: number; balls: SharedValue<Ball[]>; color: string }) {
  const style = useAnimatedStyle(() => {
    const b = balls.value[index];
    if (!b) return { opacity: 0 };
    return { opacity: 1, width: b.d, height: b.d, borderRadius: b.d / 2, transform: [{ translateX: b.x }, { translateY: b.y }] };
  });
  // A pale circle on the pale card vanished («білі кульки майже не видно»): the deeper end of its hue, a soft shadow
  // and a hairline edge, on the light theme.
  const S = useSoft();
  return <Animated.View pointerEvents="none" style={[styles.circle, { backgroundColor: color, boxShadow: S.dark ? undefined : '0px 3px 9px rgba(60,40,20,0.22)', borderWidth: S.dark ? 0 : 1, borderColor: 'rgba(60,40,20,0.16)' } as never, style]} />;
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, overflow: 'hidden' },
  circle: { position: 'absolute', left: 0, top: 0 },
  foot: { position: 'absolute', left: 16, right: 12, bottom: 12, gap: 1 },
  title: { fontSize: 20, fontFamily: SOFT_BOLD },
  loose: { fontSize: 12.5, fontFamily: SOFT_SEMIBOLD, color: '#9A5A1E' },
  empty: { position: 'absolute', left: 12, right: 12, top: 0, bottom: TITLE_ROOM, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 13, fontFamily: SOFT_SEMIBOLD, textAlign: 'center' },
});
