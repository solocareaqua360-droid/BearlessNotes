import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Easing, runOnJS, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { BlendMode, Canvas, PaintStyle, Picture, Skia, StrokeCap, TileMode, createPicture, matchFont, useClock } from '@shopify/react-native-skia';
import type { Thought, ThoughtTheme } from '../../hooks/useThoughts';
import { cardTitle } from './thoughtText';
import { FEELINGS } from './feelings';

// THOUGHTS AS NEURONS (2026-10-27, the user's picture, prototype https://claude.ai/artifact/9mnhW7YrFwirjz3JckXgP3 -
// «візуально це прям кайф»). A LENS over the same thoughts, not a new place: every thought a neuron that pulses, every
// theme a cluster with a nebula of its colour, the links between thoughts the dendrites. A tap sends a light signal
// along the links and opens the thought's own card (the owner's `onOpen`). Pulled out, the clusters read as a cosmos.
// Drawn by Skia on the UI thread: one picture per frame, recorded from plain arrays (`net`), so React renders it once.

// A thought's feeling colours its neuron (feelings.ts); one with none yet glows starlight-white.
export { FEELINGS, type Feeling } from './feelings';
const STARLIGHT = [226, 222, 236];
// A theme's own nebula: told apart by hue, all of one brightness so none shouts.
const NEBULAE = [
  [247, 160, 100],
  [150, 130, 255],
  [90, 200, 190],
  [255, 130, 190],
  [120, 170, 255],
  [240, 200, 110],
  [140, 215, 140],
];
const LOOSE_NEBULA = [170, 170, 185];

type Node = { id: string; x: number; y: number; r: number; c: number[]; ph: number; per: number; life: number; label: string; k: number };
type Edge = { a: number; b: number; bend: number };
type Cluster = { key: string | null; x: number; y: number; R: number; c: number[]; name: string; heat: number };
type Net = { nodes: Node[]; edges: Edge[]; clusters: Cluster[]; box: { x0: number; y0: number; x1: number; y1: number } };
type Spark = { a: number; b: number; t0: number; dur: number };
type Flash = { i: number; t0: number };

// A stable number from an id: the same thought lies in the same place every time the sky opens.
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function layout(themes: ThoughtTheme[], thoughts: Thought[]): Net {
  const groups: { key: string | null; name: string; c: number[] }[] = [...themes]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((t) => ({ key: t.id, name: t.name, c: NEBULAE[((t.hue % NEBULAE.length) + NEBULAE.length) % NEBULAE.length] }));
  if (thoughts.some((t) => t.themeId === null || !themes.some((th) => th.id === t.themeId))) groups.push({ key: null, name: 'Не розкладено', c: LOOSE_NEBULA });
  const nodes: Node[] = [];
  const clusters: Cluster[] = [];
  const now = Date.now();
  groups.forEach((g, gi) => {
    const mine = thoughts.filter((t) => (g.key === null ? t.themeId === null || !themes.some((th) => th.id === t.themeId) : t.themeId === g.key));
    // Clusters on a sunflower spiral: as many as there are, none on top of another.
    const ang = gi * 2.39996;
    const dist = gi === 0 ? 0 : 300 * Math.sqrt(gi);
    const cx = Math.cos(ang) * dist;
    const cy = Math.sin(ang) * dist * 0.85;
    const R = 70 + 16 * Math.sqrt(mine.length);
    let heat = 0;
    mine.forEach((t) => {
      const h1 = hash(t.id);
      const h2 = hash(t.id + '·');
      const a = h1 * Math.PI * 2;
      const r = 26 + Math.sqrt(h2) * (R - 20);
      // Fresh thoughts glow, old ones go quiet (never out): two months to the quiet end.
      const life = Math.max(0.15, Math.min(1, 1 - (now - t.createdAt) / (60 * 86400000)));
      heat += life;
      const feel = t.feel;
      const label = (cardTitle(t) || t.felt || '').replace(/\s+/g, ' ').trim();
      nodes.push({
        id: t.id,
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r * 0.85,
        r: 4 + h2 * 3,
        c: feel ? [...FEELINGS[feel].c] : STARLIGHT,
        ph: h1 * 6.28,
        per: 2.2 + h2 * 2.6,
        life,
        label: label.length > 34 ? label.slice(0, 33) + '…' : label,
        k: gi,
      });
    });
    clusters.push({ key: g.key, x: cx, y: cy, R, c: g.c, name: g.name, heat: mine.length ? heat / mine.length : 0 });
  });
  // Dendrites: the links the user drew on a theme's canvas, what an AI note was made from, and each thought to its two
  // nearest in the same theme - so a cluster is a web, not a scatter.
  const edges: Edge[] = [];
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const seen = new Set<string>();
  const join = (a: number, b: number) => {
    if (a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ a, b, bend: (hash(key) - 0.5) * 0.6 });
  };
  thoughts.forEach((t) => {
    const a = index.get(t.id);
    if (a === undefined) return;
    [...t.links, ...(t.from ?? [])].forEach((id) => {
      const b = index.get(id);
      if (b !== undefined) join(a, b);
    });
  });
  nodes.forEach((n, i) => {
    nodes
      .map((m, j) => ({ j, d: m.k === n.k && j !== i ? (m.x - n.x) ** 2 + (m.y - n.y) ** 2 : Infinity }))
      .sort((p, q) => p.d - q.d)
      .slice(0, 2)
      .forEach((p) => p.d < Infinity && join(i, p.j));
  });
  // The frame takes in each cluster with its name under it (the names are wider than the clusters).
  const xs = clusters.flatMap((c) => [c.x - c.R - 90, c.x + c.R + 90]);
  const ys = clusters.flatMap((c) => [c.y - c.R, c.y + c.R + 40]);
  const box = xs.length ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } : { x0: -200, y0: -200, x1: 200, y1: 200 };
  return { nodes, edges, clusters, box };
}

const clampZ = (z: number) => {
  'worklet';
  return Math.max(0.12, Math.min(3.2, z));
};

// INTO A THEME (step 4): pinched deep enough into a nebula, the theme opens - its own canvas. How deep counts: the
// cluster twice as big as the screen, or the zoom near its end (a small theme never gets that big). 1 = in.
const ENTER_Z = 3;
const depthOf = (R: number, z: number, room: number) => {
  'worklet';
  return Math.max((R * z) / (0.8 * room), z / ENTER_Z);
};
// The cluster a point of the sky (world units) lies in, or -1.
const clusterAt = (clusters: Cluster[], x: number, y: number) => {
  'worklet';
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < clusters.length; i++) {
    const d = Math.hypot(clusters[i].x - x, clusters[i].y - y);
    if (d < clusters[i].R * 1.15 && d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
};

export default function ThoughtsNetwork({
  width,
  height,
  themes,
  thoughts,
  onOpen,
  onEnter,
  away = false,
  top = 0,
}: {
  width: number;
  height: number;
  themes: ThoughtTheme[];
  thoughts: Thought[];
  // A tapped thought: its own card opens (the owner's - the same card as everywhere).
  onOpen: (id: string) => void;
  // A theme pinched into (null = the loose thoughts): the owner opens its canvas.
  onEnter?: (themeId: string | null) => void;
  // Something is open over the sky (that canvas): it stops drawing, and when it closes the camera backs out.
  away?: boolean;
  // How much of the top the window's own bar covers: the sky is framed below it.
  top?: number;
}) {
  const data = useMemo(() => layout(themes, thoughts), [themes, thoughts]);
  const net = useSharedValue<Net>(data);
  useEffect(() => {
    net.value = data;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const camX = useSharedValue(0);
  const camY = useSharedValue(0);
  const camZ = useSharedValue(1);
  // The sky opens framing every cluster; later changes of the data leave the camera where the user put it.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !width || !height || data.nodes.length === 0) return;
    framed.current = true;
    const b = data.box;
    const viewH = height - top;
    camZ.value = Math.max(0.3, Math.min(1.15, Math.min(width / (b.x1 - b.x0), viewH / (b.y1 - b.y0 + 60))));
    camX.value = (b.x0 + b.x1) / 2;
    camY.value = (b.y0 + b.y1) / 2 - top / 2 / camZ.value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, data]);

  const clock = useClock();
  const sparks = useSharedValue<Spark[]>([]);
  const flashes = useSharedValue<Flash[]>([]);
  const font = useMemo(() => matchFont({ fontFamily: 'sans-serif', fontSize: 12, fontWeight: '500' }), []);
  const bigFont = useMemo(() => matchFont({ fontFamily: 'sans-serif', fontSize: 15, fontWeight: '600' }), []);

  // A signal from a neuron: along every link, then on from where it arrived, three steps deep.
  const fire = (from: number, depth = 3) => {
    const { nodes, edges } = net.value;
    const now = clock.value;
    const out: Spark[] = [];
    const fl: Flash[] = [{ i: from, t0: now }];
    const reached = new Map<number, number>([[from, now]]);
    let wave = [from];
    for (let d = 0; d < depth && wave.length; d++) {
      const next: number[] = [];
      for (const a of wave) {
        for (const e of edges) {
          const b = e.a === a ? e.b : e.b === a ? e.a : -1;
          if (b < 0 || reached.has(b)) continue;
          const t0 = reached.get(a)! + 80 + Math.random() * 120;
          const dur = 480 + Math.hypot(nodes[b].x - nodes[a].x, nodes[b].y - nodes[a].y) * 2;
          out.push({ a, b, t0, dur });
          reached.set(b, t0 + dur);
          fl.push({ i: b, t0: t0 + dur });
          next.push(b);
        }
      }
      wave = next.slice(0, 12);
    }
    sparks.value = [...sparks.value.filter((s) => s.t0 + s.dur > now), ...out];
    flashes.value = [...flashes.value.filter((f) => now - f.t0 < 1500), ...fl];
  };

  // Now and then a neuron fires on its own - the sky is alive while it is looked at.
  useEffect(() => {
    const timer = setInterval(() => {
      const { nodes } = net.value;
      if (!nodes.length) return;
      const i = Math.floor(Math.random() * nodes.length);
      if (nodes[i].life > 0.35) fire(i, 2);
    }, 1800);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tapAt = (sx: number, sy: number) => {
    const { nodes, clusters } = net.value;
    const z = camZ.value;
    const toS = (x: number, y: number) => [(x - camX.value) * z + width / 2, (y - camY.value) * z + height / 2];
    let best = -1;
    let bd = 30 * 30;
    nodes.forEach((n, i) => {
      const [x, y] = toS(n.x, n.y);
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0 && z > 0.45) {
      fire(best);
      const id = nodes[best].id;
      setTimeout(() => onOpen(id), 260);
      return;
    }
    // Far out a tap on a cluster flies into it.
    const hit = clusters.find((c) => {
      const [x, y] = toS(c.x, c.y);
      return Math.hypot(x - sx, y - sy) < Math.max(40, c.R * z);
    });
    if (hit) {
      camX.value = hit.x;
      camY.value = hit.y;
      camZ.value = Math.max(z, Math.min(1.6, (Math.min(width, height - top) * 0.42) / hit.R));
    }
  };

  // Pinched in: once per dive; the camera is left where it was, so «back» lands on the same place.
  const entering = useSharedValue(0);
  const entered = useRef<Cluster | null>(null);
  const enter = (i: number) => {
    const k = net.value.clusters[i];
    if (!k || !onEnter) return;
    entered.current = k;
    onEnter(k.key);
  };
  // Back from the canvas: the sky flies out of the nebula to where it is whole on the screen again.
  const [sleeping, setSleeping] = useState(false);
  useEffect(() => {
    if (away) {
      const timer = setTimeout(() => setSleeping(true), 450);
      return () => clearTimeout(timer);
    }
    setSleeping(false);
    const k = entered.current;
    entered.current = null;
    entering.value = 0;
    if (!k) return;
    const ease = { duration: 520, easing: Easing.out(Easing.cubic) };
    camX.value = withTiming(k.x, ease);
    camY.value = withTiming(k.y + k.R * 0.15, ease);
    camZ.value = withTiming(Math.max(0.3, Math.min(1.6, (Math.min(width, height - top) * 0.42) / k.R)), ease);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [away]);

  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const pz0 = useSharedValue(1);
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const sx0 = useSharedValue(0);
  const sy0 = useSharedValue(0);
  const gesture = useMemo(() => {
    // One finger moves the sky; two are the pinch's alone. The finger is measured from where THIS gesture started, not
    // from where it first touched down: after a pinch the remaining finger has drifted all along, and translationX would
    // bring that drift in as a jump (the board's own cure, BoardScreen's panGesture).
    const pan = Gesture.Pan()
      .minPointers(1)
      .maxPointers(1)
      .onStart((e) => {
        panX.value = camX.value;
        panY.value = camY.value;
        sx0.value = e.absoluteX;
        sy0.value = e.absoluteY;
      })
      .onUpdate((e) => {
        camX.value = panX.value - (e.absoluteX - sx0.value) / camZ.value;
        camY.value = panY.value - (e.absoluteY - sy0.value) / camZ.value;
      });
    const pinch = Gesture.Pinch()
      .onStart((e) => {
        pz0.value = camZ.value;
        // The point under the fingers stays under them.
        fx.value = (e.focalX - width / 2) / camZ.value + camX.value;
        fy.value = (e.focalY - height / 2) / camZ.value + camY.value;
      })
      .onUpdate((e) => {
        const z = clampZ(pz0.value * e.scale);
        camZ.value = z;
        camX.value = fx.value - (e.focalX - width / 2) / z;
        camY.value = fy.value - (e.focalY - height / 2) / z;
        if (entering.value) return;
        const { clusters } = net.value;
        const i = clusterAt(clusters, fx.value, fy.value);
        if (i >= 0 && depthOf(clusters[i].R, z, Math.min(width, height - top)) >= 1) {
          entering.value = 1;
          runOnJS(enter)(i);
        }
      })
      // The moment one finger lifts, Android recomputes the focal from the finger left - a jump in one ordinary frame.
      // The pinch ends on that touch-up, before it can read it (as the board's pinch does).
      .onTouchesUp((e, state) => {
        if (e.numberOfTouches < 2) state.end();
      });
    const tap = Gesture.Tap()
      .maxDistance(10)
      .onEnd((e, ok) => {
        if (ok) runOnJS(tapAt)(e.x, e.y);
      });
    return Gesture.Race(tap, Gesture.Simultaneous(pan, pinch));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, top]);

  const picture = useDerivedValue(() => {
    const W = width;
    const H = height;
    const now = clock.value;
    const t = now / 1000;
    const { nodes, edges, clusters } = net.value;
    const sp = sparks.value;
    const fl = flashes.value;
    const z = camZ.value;
    const cx = camX.value;
    const cy = camY.value;
    // 0 = the cosmos (far out), 1 = the neurons (close).
    const near = Math.min(1, Math.max(0, (z - 0.2) / 0.3));
    const sx = (x: number) => (x - cx) * z + W / 2;
    const sy = (y: number) => (y - cy) * z + H / 2;
    const col = (c: number[], a: number) => Float32Array.of(c[0] / 255, c[1] / 255, c[2] / 255, a);
    const glow = (canvas: { drawCircle: (x: number, y: number, r: number, p: ReturnType<typeof Skia.Paint>) => void }, paint: ReturnType<typeof Skia.Paint>, x: number, y: number, R: number, c: number[], a: number) => {
      if (R < 0.5 || a <= 0.003) return;
      paint.setShader(
        Skia.Shader.MakeRadialGradient({ x, y }, R, [col(c, a), col(c, a * 0.55), col(c, a * 0.12), col(c, 0)], [0, 0.18, 0.45, 1], TileMode.Clamp)
      );
      canvas.drawCircle(x, y, R, paint);
    };
    // The brightness a flash adds to a neuron right now.
    const flashOf = (i: number) => {
      let f = 0;
      for (const x of fl) {
        if (x.i !== i) continue;
        const age = now - x.t0;
        if (age >= 0 && age < 1400) f = Math.max(f, 1 - age / 1400);
      }
      return f;
    };
    return createPicture((canvas) => {
      const bg = Skia.Paint();
      bg.setColor(Skia.Color('#05060B'));
      canvas.drawRect({ x: 0, y: 0, width: W, height: H }, bg);
      const vg = Skia.Paint();
      vg.setShader(
        Skia.Shader.MakeRadialGradient({ x: W / 2, y: H / 2 }, Math.max(W, H) * 0.75, [Float32Array.of(40 / 255, 30 / 255, 70 / 255, 0.35), Float32Array.of(0, 0, 0, 0)], null, TileMode.Clamp)
      );
      canvas.drawRect({ x: 0, y: 0, width: W, height: H }, vg);

      const lit = Skia.Paint();
      lit.setBlendMode(BlendMode.Plus);
      lit.setAntiAlias(true);

      // Nebulae: each theme a soft cloud, strongest far out.
      for (const k of clusters) {
        const R = (k.R * 2.6 + 60) * z;
        glow(canvas, lit, sx(k.x), sy(k.y), R, k.c, (0.1 + (1 - near) * 0.45) * (0.6 + k.heat * 0.6));
      }
      // Diving into a theme: past half way its colour fills the screen and its name comes up - the door opening.
      const room = Math.min(W, H - top);
      const ki = clusterAt(clusters, cx, cy + top / 2 / z);
      const dive = ki >= 0 ? Math.min(1, Math.max(0, (depthOf(clusters[ki].R, z, room) - 0.55) / 0.45)) : 0;
      if (dive > 0) {
        const k = clusters[ki];
        glow(canvas, lit, W / 2, (H + top) / 2, Math.max(W, H) * 0.9, k.c, dive * 0.32);
      }

      // Dendrites.
      const line = Skia.Paint();
      line.setStyle(PaintStyle.Stroke);
      line.setStrokeCap(StrokeCap.Round);
      line.setBlendMode(BlendMode.Plus);
      line.setAntiAlias(true);
      line.setStrokeWidth(Math.max(0.6, 1.2 * z));
      for (const e of edges) {
        const A = nodes[e.a];
        const B = nodes[e.b];
        if (!A || !B) continue;
        const x1 = sx(A.x);
        const y1 = sy(A.y);
        const x2 = sx(B.x);
        const y2 = sy(B.y);
        const a = (0.08 + 0.22 * Math.min(A.life, B.life)) * near;
        if (a < 0.01) continue;
        line.setColor(col(A.c, a));
        const p = Skia.Path.Make();
        p.moveTo(x1, y1);
        p.quadTo((x1 + x2) / 2 + (y2 - y1) * e.bend * 0.3, (y1 + y2) / 2 - (x2 - x1) * e.bend * 0.3, x2, y2);
        canvas.drawPath(p, line);
      }

      // Signals running along the links.
      for (const s of sp) {
        const p = (now - s.t0) / s.dur;
        if (p < 0 || p > 1) continue;
        const A = nodes[s.a];
        const B = nodes[s.b];
        if (!A || !B) continue;
        const x1 = sx(A.x);
        const y1 = sy(A.y);
        const x2 = sx(B.x);
        const y2 = sy(B.y);
        const e = edges.find((q) => (q.a === s.a && q.b === s.b) || (q.a === s.b && q.b === s.a));
        const bend = e ? (e.a === s.a ? e.bend : -e.bend) : 0;
        const mx = (x1 + x2) / 2 + (y2 - y1) * bend * 0.3;
        const my = (y1 + y2) / 2 - (x2 - x1) * bend * 0.3;
        const u = 1 - p;
        const x = u * u * x1 + 2 * u * p * mx + p * p * x2;
        const y = u * u * y1 + 2 * u * p * my + p * p * y2;
        glow(canvas, lit, x, y, Math.max(6, 16 * z), A.c, near * Math.sin(p * Math.PI));
      }

      // Neurons.
      const core = Skia.Paint();
      core.setAntiAlias(true);
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const x = sx(n.x + Math.sin(t * 0.5 + n.ph) * 2.2);
        const y = sy(n.y + Math.cos(t * 0.43 + n.ph) * 2.2);
        if (x < -80 || y < -80 || x > W + 80 || y > H + 80) continue;
        const pulse = 0.55 + 0.45 * Math.sin((t / n.per) * 6.28 + n.ph);
        const f = flashOf(i);
        const g = (0.25 + n.life * 0.75) * (0.55 + pulse * 0.45) + f * 1.2;
        const s = (n.r * 13 + f * 46) * Math.max(0.4, z);
        glow(canvas, lit, x, y, s / 2, n.c, Math.min(1, g) * (0.35 + near * 0.65));
        core.setColor(col([Math.min(255, n.c[0] + 60), Math.min(255, n.c[1] + 60), Math.min(255, n.c[2] + 60)], Math.min(1, 0.35 + n.life * 0.65) * near));
        canvas.drawCircle(x, y, Math.max(1, n.r * 0.55 * z), core);
      }

      // Words: the themes' names far out, the thoughts' own lines close in.
      const ink = Skia.Paint();
      ink.setAntiAlias(true);
      if (near < 0.85) {
        ink.setColor(col([237, 234, 245], 0.9 * (1 - near)));
        for (const k of clusters) {
          const w = bigFont.getTextWidth(k.name);
          // A long name is kept on the screen rather than cut by its edge.
          const x = Math.max(12, Math.min(W - w - 12, sx(k.x) - w / 2));
          canvas.drawText(k.name, x, sy(k.y) + k.R * z * 0.9 + 22, ink, bigFont);
        }
      }
      if (dive > 0) {
        const k = clusters[ki];
        const w = bigFont.getTextWidth(k.name);
        ink.setColor(col([255, 255, 255], dive * 0.95));
        canvas.drawText(k.name, Math.max(12, (W - w) / 2), top + 44, ink, bigFont);
      }
      if (z > 1.1) {
        for (const n of nodes) {
          if (!n.label) continue;
          const x = sx(n.x);
          const y = sy(n.y);
          if (x < -100 || y < 0 || x > W + 100 || y > H) continue;
          ink.setColor(col([237, 234, 245], Math.min(1, (z - 1.1) * 2.5) * (0.45 + n.life * 0.55)));
          const w = font.getTextWidth(n.label);
          canvas.drawText(n.label, x - w / 2, y - 10 * Math.min(z, 2) - 4, ink, font);
        }
      }
    });
  });

  return (
    <GestureDetector gesture={gesture}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#05060B' }]} collapsable={false}>
        {/* The night sky wants the light status bar, whatever the app's own theme. */}
        {!away && <StatusBar style="light" />}
        {!sleeping && (
          <Canvas style={{ width, height }}>
            <Picture picture={picture} />
          </Canvas>
        )}
      </View>
    </GestureDetector>
  );
}
