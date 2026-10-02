import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { dockClearance } from '../navigation/dockGeometry';
import { WORLD_HALF, type CanvasOverlayApi, type FolderRect } from './FolderCanvas';

// THE DATABASES AND THEIR FOLDERS, AS LINES (the user's design, 2026-10-02):
// a round button at the bottom left of the folders' canvas; pressed, the
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
const BUTTON = 52;
const CIRCLE = 44;
const STEP = CIRCLE + 10;
const SIDE = 16;
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
  api,
  bases,
  links,
  onBind,
  onUnbind,
}: {
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
  const [open, setOpen] = useState(false);
  // Drawn while opening, open, or closing.
  const [shown, setShown] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const appear = useSharedValue(0);
  const draw = useSharedValue(0);
  const drag = useSharedValue({ on: 0, x0: 0, y0: 0, x1: 0, y1: 0 });

  const bottom = insets.bottom + dockClearance(width, 10);
  const buttonX = SIDE + BUTTON / 2;
  const buttonY = height - bottom - BUTTON / 2;
  const circleY = (i: number) => buttonY - BUTTON / 2 - 8 - CIRCLE / 2 - i * STEP;

  useEffect(() => {
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

  const dragProps = useAnimatedProps(() => {
    const d = drag.value;
    if (!d.on) return { d: 'M0,0', opacity: 0 };
    const mx = (d.x0 + d.x1) / 2;
    return { d: `M${d.x0},${d.y0} C${mx},${d.y0} ${mx},${d.y1} ${d.x1},${d.y1}`, opacity: 1 };
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={(e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height)}>
      {shown && height > 0 && (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {links.map((link) => {
            const index = bases.findIndex((b) => b.kind === link.kind);
            const rect = rectFor(api.rects, link.path);
            if (index < 0 || !rect) return null;
            const base = bases[index];
            return (
              <LinkLine
                key={`${link.kind}|${link.path}`}
                link={link}
                rect={rect}
                bx={buttonX + CIRCLE / 2}
                by={circleY(index)}
                color={base.color}
                dimmed={focus !== null && focus !== link.kind}
                api={api}
                draw={draw}
                onPress={() => onUnbind(link)}
              />
            );
          })}
          <AnimatedPath animatedProps={dragProps} stroke={S.ink2} strokeWidth={2} strokeDasharray="6 5" fill="none" />
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
            cx={buttonX}
            cy={circleY(i)}
            appear={appear}
            drag={drag}
            focused={focus === base.kind}
            onTap={() => setFocus((f) => (f === base.kind ? null : base.kind))}
            onDrop={dropAt}
          />
        ))}
      {height > 0 && (
        <Pressable
          onPress={() => {
            setFocus(null);
            setOpen((v) => !v);
          }}
          style={[
            styles.button,
            { left: SIDE, top: buttonY - BUTTON / 2, backgroundColor: open ? S.ink : S.card, boxShadow: S.shadow },
          ]}
        >
          <Ionicons name={open ? 'close' : 'git-network-outline'} size={22} color={open ? S.card : S.ink} />
        </Pressable>
      )}
    </View>
  );
}

function LinkLine({
  link,
  rect,
  bx,
  by,
  color,
  dimmed,
  api,
  draw,
  onPress,
}: {
  link: BaseLink;
  rect: FolderRect;
  bx: number;
  by: number;
  color: string;
  dimmed: boolean;
  api: CanvasOverlayApi;
  draw: SharedValue<number>;
  onPress: () => void;
}) {
  // Plain numbers and shared values for the worklet - never the objects
  // they came in (see the worklet-closure memory).
  const rx = rect.x;
  const ry = rect.y + rect.h / 2;
  const tx = api.tx;
  const ty = api.ty;
  const scale = api.scale;
  const props = useAnimatedProps(() => {
    const ex = (rx + WORLD_HALF) * scale.value + tx.value;
    const ey = (ry + WORLD_HALF) * scale.value + ty.value;
    const c1x = bx + Math.max(40, (ex - bx) * 0.5);
    const c2x = ex - Math.max(40, (ex - bx) * 0.5);
    // The snake: the same curve cut at t (de Casteljau), t growing.
    const t = Math.max(0.001, draw.value);
    const ax = bx + (c1x - bx) * t;
    const ay = by;
    const bxm = c1x + (c2x - c1x) * t;
    const bym = by + (ey - by) * t;
    const cx = c2x + (ex - c2x) * t;
    const cy = ey;
    const abx = ax + (bxm - ax) * t;
    const aby = ay + (bym - ay) * t;
    const bcx = bxm + (cx - bxm) * t;
    const bcy = bym + (cy - bym) * t;
    const px = abx + (bcx - abx) * t;
    const py = aby + (bcy - aby) * t;
    return { d: `M${bx},${by} C${ax},${ay} ${abx},${aby} ${px},${py}` };
  });
  const solid = link.count > 0;
  return (
    <>
      <AnimatedPath
        animatedProps={props}
        stroke={color}
        strokeWidth={solid ? 2.5 : 2}
        strokeDasharray={solid ? undefined : '6 5'}
        strokeLinecap="round"
        fill="none"
        opacity={dimmed ? 0.15 : 0.9}
      />
      {/* A wide, all-but-invisible twin: a 2px line is too thin to hit. */}
      <AnimatedPath animatedProps={props} stroke={color} strokeOpacity={0.01} strokeWidth={18} fill="none" onPress={onPress} />
    </>
  );
}

function BaseCircle({
  base,
  index,
  count,
  cx,
  cy,
  appear,
  drag,
  focused,
  onTap,
  onDrop,
}: {
  base: LinkBase;
  index: number;
  count: number;
  cx: number;
  cy: number;
  appear: SharedValue<number>;
  drag: SharedValue<{ on: number; x0: number; y0: number; x1: number; y1: number }>;
  focused: boolean;
  onTap: () => void;
  onDrop: (kind: string, x: number, y: number) => void;
}) {
  const S = useSoft();
  const kind = base.kind;
  // Rising one after another out of the button, the nearest first.
  const lag = Math.min(0.12, 0.6 / Math.max(1, count));
  const rise = (index + 1) * STEP;
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
      .onUpdate((e) => {
        drag.value = { on: 1, x0, y0, x1: cx + e.translationX, y1: cy + e.translationY };
      })
      .onEnd((e) => {
        drag.value = { on: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
        runOnJS(onDrop)(kind, cx + e.translationX, cy + e.translationY);
      })
      .onFinalize(() => {
        drag.value = { on: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
      });
    return Gesture.Exclusive(pan, tap);
  }, [cx, cy, kind, drag, onTap, onDrop]);
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
  button: {
    position: 'absolute',
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
