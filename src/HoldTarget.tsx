import { useMemo, useRef, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

// App-only. One card that can be tapped, held (a menu opens over it) and,
// if `draggable`, held and then dragged (it follows the finger and is
// dropped somewhere). Everything is one gesture, so the finger that holds
// is the finger that drags. The menu and the lifted copy are drawn by the
// parent in a layer of the screen (no Modal: a Modal would steal the touch).
export type Rect = { x: number; y: number; w: number; h: number };

type Handlers = {
  onTap: () => void;
  onHold: (rect: Rect) => void; // window coordinates
  onDragStart?: () => void;
  onDragMove?: (absX: number, absY: number) => void;
  onDragEnd?: () => void;
};

export default function HoldTarget({
  children,
  style,
  draggable = false,
  dimmed = false,
  tx,
  ty,
  ...handlers
}: Handlers & { children: ReactNode; style?: StyleProp<ViewStyle>; draggable?: boolean; dimmed?: boolean; tx: SharedValue<number>; ty: SharedValue<number> }) {
  const ref = useRef<View>(null);
  const latest = useRef<Handlers>(handlers);
  latest.current = handlers;
  const dragging = useSharedValue(false);
  // A press settles the card a little (0.97) and lets it back.
  const press = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  const gesture = useMemo(() => {
    // The handlers are read through the ref, so the gesture is built once
    // and a re-render in the middle of a hold cannot reset it.
    const call = (name: string, a = 0, b = 0) => {
      const h = latest.current;
      if (name === 'tap') h.onTap();
      else if (name === 'hold') ref.current?.measureInWindow((x, y, w, ht) => h.onHold({ x, y, w, h: ht }));
      else if (name === 'dragStart') h.onDragStart?.();
      else if (name === 'dragMove') h.onDragMove?.(a, b);
      else if (name === 'dragEnd') h.onDragEnd?.();
    };
    const pan = Gesture.Pan()
      .activateAfterLongPress(450)
      .onBegin(() => {
        press.value = withTiming(0.97, { duration: 90 });
      })
      .onStart(() => {
        dragging.value = false;
        tx.value = 0;
        ty.value = 0;
        runOnJS(call)('hold');
      })
      .onUpdate((e) => {
        if (!draggable) return;
        if (!dragging.value && Math.hypot(e.translationX, e.translationY) > 14) {
          dragging.value = true;
          runOnJS(call)('dragStart');
        }
        if (dragging.value) {
          tx.value = e.translationX;
          ty.value = e.translationY;
          runOnJS(call)('dragMove', e.absoluteX, e.absoluteY);
        }
      })
      .onFinalize(() => {
        press.value = withTiming(1, { duration: 160 });
        if (dragging.value) {
          dragging.value = false;
          runOnJS(call)('dragEnd');
        }
      });
    const tap = Gesture.Tap()
      .maxDuration(280)
      .onEnd((_e, ok) => {
        if (ok) runOnJS(call)('tap');
      });
    return Gesture.Exclusive(pan, tap);
  }, []);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View ref={ref as never} collapsable={false} style={[style, pressStyle, dimmed && { opacity: 0.4 }]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
