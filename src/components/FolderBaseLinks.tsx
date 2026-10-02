import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { DOCK_BOTTOM, dockBodyHeight, dockCardHeight, dockRowLeft } from '../navigation/dockGeometry';
import { WORLD_HALF, type CanvasOverlayApi, type FolderRect } from './FolderCanvas';

// THE DATABASES AND THEIR FOLDERS, AS LINES (the user's design, 2026-10-02):
// the dock's LEFT bead on the folders' canvas (level with the view bead on
// the right - the user's correction; the screen owns it and says `open`);
// pressed, the
// databases rise out of it as circles, one above another, and then lines
// draw themselves like snakes from each database to the folders it shows.
// Pressed again, the lines wind back first and then the circles sink into
// the button.
//
// A line tells the truth: SOLID - something of that database is in the
// folder; DASHED - the folder shows in that database but holds nothing of
// it yet. A line is drawn by dragging from a database's circle onto a
// folder. Tapping a line asks what to do: a dashed one simply goes; a
// solid one never hides what is inside - its contents are taken out of
// the folder or moved to another (the caller asks, see onUnbind).

export type LinkBase = { kind: string; label: string; icon: string; color: string };
export type BaseLink = { kind: string; path: string; count: number };

const AnimatedPath = Animated.createAnimatedComponent(Path);
const CIRCLE = 44;
const STEP = CIRCLE + 10;
// The closest two circles may stand when there are many databases.
const MIN_STEP = CIRCLE + 2;
const APPEAR_MS = 320;
const DRAW_MS = 480;

// A folder's rect, or its nearest ancestor's that can be seen (a closed
// island hides what is inside it).
function rectFor(rects: Record<string, FolderRect>, path: string): FolderRect | null {
  let p: string | null = path;
  while (p) {
    if (rects[p]) return rects[p];
    const cut = p.lastIndexOf('/');
    p = cut > 0 ? p.slice(0, cut) : null;
  }
  return null;
}

export default function FolderBaseLinks({
  open,
  topLimit,
  api,
  bases,
  links,
  onBind,
  onUnbind,
}: {
  open: boolean;
  // Where the column may reach up to (under the bar at the top).
  topLimit: number;
  api: CanvasOverlayApi;
  bases: LinkBase[];
  links: BaseLink[];
  onBind: (kind: string, path: string) => void;
  onUnbind: (link: BaseLink) => void;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [height, setHeight] = useState(0);
  // Drawn while opening, open, or closing.
  const [shown, setShown] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const appear = useSharedValue(0);
  const draw = useSharedValue(0);
  const drag = useSharedValue({ on: 0, x0: 0, y0: 0, x1: 0, y1: 0 });
  // Where the table rests: the tap targets are drawn there, and only while
  // it is still (useAnimatedReaction marks every move; a beat after the
  // last one it is resting again).
  const [resting, setResting] = useState({ tx: api.tx.value, ty: api.ty.value, scale: api.scale.value });
  const [settled, setSettled] = useState(true);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moved = () => {
    setSettled((s) => (s ? false : s));
    if (restTimer.current) clearTimeout(restTimer.current);
    restTimer.current = setTimeout(() => {
      setResting({ tx: api.tx.value, ty: api.ty.value, scale: api.scale.value });
      setSettled(true);
    }, 180);
  };
  const ptx = api.tx;
  const pty = api.ty;
  const pscale = api.scale;
  // Only while the lines are out - the canvas moves all day without them.
  const watching = useSharedValue(0);
  useAnimatedReaction(
    () => ptx.value + pty.value * 7 + pscale.value * 1000,
    (now, before) => {
      if (watching.value && before !== null && now !== before) runOnJS(moved)();
    }
  );

  // The bead the circles rise out of: the dock's left one.
  const bead = dockCardHeight(width);
  const buttonX = dockRowLeft(width) + bead / 2;
  const buttonY = height - insets.bottom - DOCK_BOTTOM - dockBodyHeight(width) / 2;
  const firstY = buttonY - bead / 2 - 10 - CIRCLE / 2;
  // Closer together when there are many, so the column stays under the bar.
  const room = firstY - (topLimit + CIRCLE / 2 + 8);
  const step = bases.length > 1 ? Math.max(MIN_STEP, Math.min(STEP, room / (bases.length - 1))) : STEP;
  const circleY = (i: number) => firstY - i * step;

  useEffect(() => {
    watching.value = shown ? 1 : 0;
    if (shown) setResting({ tx: api.tx.value, ty: api.ty.value, scale: api.scale.value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  useEffect(() => {
    if (!open) setFocus(null);
    if (open) {
      setShown(true);
      appear.value = withTiming(1, { duration: APPEAR_MS, easing: Easing.out(Easing.cubic) }, (done) => {
        if (done) draw.value = withTiming(1, { duration: DRAW_MS, easing: Easing.inOut(Easing.cubic) });
      });
    } else if (shown) {
      const hide = () => setShown(false);
      draw.value = withTiming(0, { duration: DRAW_MS * 0.7, easing: Easing.inOut(Easing.cubic) }, (done) => {
        if (done)
          appear.value = withTiming(0, { duration: APPEAR_MS * 0.8, easing: Easing.in(Easing.cubic) }, (gone) => {
            if (gone) runOnJS(hide)();
          });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dropAt = (kind: string, x: number, y: number) => {
    const wx = (x - api.tx.value) / api.scale.value - WORLD_HALF;
    const wy = (y - api.ty.value) / api.scale.value - WORLD_HALF;
    const hit = Object.entries(api.rects).find(([, r]) => wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h);
    if (hit && !links.some((l) => l.kind === kind && l.path === hit[0])) onBind(kind, hit[0]);
  };

  // The line being drawn is THERE only while a finger draws it: a hidden
  // path stayed on screen where the finger let go (2026-10-02).
  const [drawing, setDrawing] = useState(false);
  const dragProps = useAnimatedProps(() => {
    const d = drag.value;
    const mx = (d.x0 + d.x1) / 2;
    return { d: `M${d.x0},${d.y0} C${mx},${d.y0} ${mx},${d.y1} ${d.x1},${d.y1}` };
  });

  // Lines gathered by database and style; each entry where its folder is.
  type Entry = { bx: number; by: number; rx: number; ry: number; half: number; lx: SharedValue<number> | null; ly: SharedValue<number> | null };
  const groupMap = new Map<string, { key: string; kind: string; color: string; solid: boolean; entries: Entry[] }>();
  const hits: { key: string; d: string; onPress: () => void }[] = [];
  links.forEach((link) => {
    const index = bases.findIndex((b) => b.kind === link.kind);
    const rect = rectFor(api.rects, link.path);
    if (index < 0 || !rect) return;
    const solid = link.count > 0;
    const key = `${link.kind}|${solid ? 's' : 'd'}`;
    if (!groupMap.has(key)) groupMap.set(key, { key, kind: link.kind, color: bases[index].color, solid, entries: [] });
    const live = api.live(link.path);
    const entry: Entry = {
      bx: buttonX + CIRCLE / 2,
      by: circleY(index),
      rx: rect.x,
      ry: rect.y + rect.h / 2,
      half: rect.h / 2,
      lx: live?.px ?? null,
      ly: live?.py ?? null,
    };
    groupMap.get(key)!.entries.push(entry);
    const ex = (entry.rx + WORLD_HALF) * resting.scale + resting.tx;
    const ey = (entry.ry + WORLD_HALF) * resting.scale + resting.ty;
    hits.push({ key: `${link.kind}|${link.path}`, d: curve(entry.bx, entry.by, ex, ey, 1), onPress: () => onUnbind(link) });
  });
  const groups = [...groupMap.values()];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={(e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height)}>
      {shown && height > 0 && (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* ONE path per database and line style - not one per line: every
              animated path is its own update each frame, and thirty of them
              could not keep up with the table under the finger (the lines
              trailed off their folders, 2026-10-02). */}
          {groups.map((group) => (
            <GroupLines
              key={group.key}
              entries={group.entries}
              color={group.color}
              solid={group.solid}
              dimmed={focus !== null && focus !== group.kind}
              api={api}
              draw={draw}
            />
          ))}
          {/* What a finger taps, one per line - plain paths at the table's
              last resting place, gone while it moves. */}
          {settled &&
            hits.map((hit) => (
              <Path key={hit.key} d={hit.d} stroke="#000" strokeOpacity={0.01} strokeWidth={18} fill="none" onPress={hit.onPress} />
            ))}
          {drawing && (
            <AnimatedPath animatedProps={dragProps} stroke={S.ink2} strokeWidth={2} strokeDasharray="6 5" fill="none" />
          )}
        </Svg>
      )}
      {shown &&
        height > 0 &&
        bases.map((base, i) => (
          <BaseCircle
            key={base.kind}
            base={base}
            index={i}
            count={bases.length}
            step={step}
            cx={buttonX}
            cy={circleY(i)}
            appear={appear}
            drag={drag}
            focused={focus === base.kind}
            onTap={() => setFocus((f) => (f === base.kind ? null : base.kind))}
            onDrop={dropAt}
            onDrawing={setDrawing}
          />
        ))}
    </View>
  );
}

// The cubic from a database's circle to a folder's left edge, cut at t
// (de Casteljau) - the snake drawing itself, t growing.
function curve(bx: number, by: number, ex: number, ey: number, t: number): string {
  'worklet';
  const c1x = bx + Math.max(40, (ex - bx) * 0.5);
  const c2x = ex - Math.max(40, (ex - bx) * 0.5);
  const ax = bx + (c1x - bx) * t;
  const bxm = c1x + (c2x - c1x) * t;
  const bym = by + (ey - by) * t;
  const cx = c2x + (ex - c2x) * t;
  const abx = ax + (bxm - ax) * t;
  const aby = by + (bym - by) * t;
  const bcx = bxm + (cx - bxm) * t;
  const bcy = bym + (ey - bym) * t;
  const px = abx + (bcx - abx) * t;
  const py = aby + (bcy - aby) * t;
  return `M${bx},${by} C${ax},${by} ${abx},${aby} ${px},${py}`;
}

function GroupLines({
  entries,
  color,
  solid,
  dimmed,
  api,
  draw,
}: {
  entries: { bx: number; by: number; rx: number; ry: number; half: number; lx: SharedValue<number> | null; ly: SharedValue<number> | null }[];
  color: string;
  solid: boolean;
  dimmed: boolean;
  api: CanvasOverlayApi;
  draw: SharedValue<number>;
}) {
  // Plain numbers and shared values for the worklet - never the objects
  // they came in (see the worklet-closure memory).
  const tx = api.tx;
  const ty = api.ty;
  const scale = api.scale;
  const list = entries;
  const props = useAnimatedProps(() => {
    const t = Math.max(0.001, draw.value);
    let d = '';
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      // A folder a finger carries is followed where it is now.
      const wx = e.lx ? e.lx.value : e.rx;
      const wy = e.ly ? e.ly.value + e.half : e.ry;
      const ex = (wx + WORLD_HALF) * scale.value + tx.value;
      const ey = (wy + WORLD_HALF) * scale.value + ty.value;
      d += curve(e.bx, e.by, ex, ey, t) + ' ';
    }
    return { d: d || 'M0,0' };
  });
  return (
    <AnimatedPath
      animatedProps={props}
      stroke={color}
      strokeWidth={solid ? 2.5 : 2}
      strokeDasharray={solid ? undefined : '6 5'}
      strokeLinecap="round"
      fill="none"
      opacity={dimmed ? 0.15 : 0.9}
    />
  );
}

function BaseCircle({
  base,
  index,
  count,
  step,
  cx,
  cy,
  appear,
  drag,
  focused,
  onTap,
  onDrop,
  onDrawing,
}: {
  base: LinkBase;
  index: number;
  count: number;
  step: number;
  cx: number;
  cy: number;
  appear: SharedValue<number>;
  drag: SharedValue<{ on: number; x0: number; y0: number; x1: number; y1: number }>;
  focused: boolean;
  onTap: () => void;
  onDrop: (kind: string, x: number, y: number) => void;
  onDrawing: (on: boolean) => void;
}) {
  const S = useSoft();
  const kind = base.kind;
  // Rising one after another out of the button, the nearest first.
  const lag = Math.min(0.12, 0.6 / Math.max(1, count));
  const rise = (index + 1) * step;
  const style = useAnimatedStyle(() => {
    const k = Math.min(1, Math.max(0, appear.value * (1 + index * lag) - index * lag));
    return { opacity: k, transform: [{ translateY: (1 - k) * rise }, { scale: 0.6 + 0.4 * k }] };
  });
  const gesture = useMemo(() => {
    const x0 = cx + CIRCLE / 2;
    const y0 = cy;
    const tap = Gesture.Tap().onEnd(() => {
      runOnJS(onTap)();
    });
    const pan = Gesture.Pan()
      .minDistance(6)
      .onStart(() => {
        drag.value = { on: 1, x0, y0, x1: x0, y1: y0 };
        runOnJS(onDrawing)(true);
      })
      .onUpdate((e) => {
        drag.value = { on: 1, x0, y0, x1: cx + e.translationX, y1: cy + e.translationY };
      })
      .onEnd((e) => {
        drag.value = { on: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
        runOnJS(onDrop)(kind, cx + e.translationX, cy + e.translationY);
      })
      .onFinalize(() => {
        drag.value = { on: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
        runOnJS(onDrawing)(false);
      });
    return Gesture.Exclusive(pan, tap);
  }, [cx, cy, kind, drag, onTap, onDrop, onDrawing]);
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.circle,
          {
            left: cx - CIRCLE / 2,
            top: cy - CIRCLE / 2,
            backgroundColor: S.card,
            borderColor: focused ? base.color : 'transparent',
            boxShadow: S.shadow,
          },
          style,
        ]}
      >
        <Ionicons name={base.icon as never} size={20} color={base.color} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  circle: {
    position: 'absolute',
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
