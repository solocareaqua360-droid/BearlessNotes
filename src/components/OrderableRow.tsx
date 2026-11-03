import { useRef, useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

// A row that can be put in another place by hand (2026-10-26, the user: «треба мати можливість переміщати справи в
// довільному порядку»): hold it, then drag. The row rides the finger, a line shows where it will land and nothing else
// moves until the finger lifts - the way the note's blocks are moved (BlockList's drop line), so the list never jumps
// under the finger. What it means for the order is the owner's (`ctl`).
export type OrderControl = {
  register: (id: string, node: View | null) => void;
  begin: (id: string, ids: string[]) => void;
  move: (absoluteY: number) => void;
  end: () => void;
  cancel: () => void;
};

export default function OrderableRow({
  id,
  ids,
  ctl,
  enabled = true,
  radius = 16,
  outline = 'rgba(30,30,28,0.28)',
  shift,
  children,
}: {
  id: string;
  // The rows it is ordered among (its own list, in the order shown).
  ids: string[];
  ctl: OrderControl;
  enabled?: boolean;
  // The row's own corner and the colour of the dashed outline left where it stood (the user, 2026-10-26: «не дірку, а
  // пунктирну обводку по розміру цього блока справи»).
  radius?: number;
  outline?: string;
  // How far the list has scrolled under the carry (hooks/useDragScroll): the row in the hand stays under the finger.
  shift?: SharedValue<number>;
  children: ReactNode;
}) {
  const [carried, setCarried] = useState(false);
  const lift = useSharedValue(0);
  const ty = useSharedValue(0);
  const inHand = useSharedValue(0);
  // The laptop: the mouse lifting after a drag is also a click on the row, and the row's own press opened the task's note
  // (2026-11-03). The click that ends a drag is swallowed before it reaches the row (swallowClick below).
  const draggedAt = useRef(0);
  const markDragged = () => {
    draggedAt.current = Date.now();
  };
  // The latest list, read when the drag starts (the gesture is built once per render, the ids change with the data).
  const live = useRef({ ids, ctl });
  live.current = { ids, ctl };
  const begin = () => {
    // Marked from the start of the drag, not only its end: the click may land before the end's own call does.
    draggedAt.current = Number.MAX_SAFE_INTEGER;
    setCarried(true);
    live.current.ctl.begin(id, live.current.ids);
  };
  const move = (y: number) => live.current.ctl.move(y);
  const end = () => {
    setCarried(false);
    live.current.ctl.end();
  };
  const swallowClick = (node: unknown) => {
    const el = node as HTMLElement | null;
    if (Platform.OS !== 'web' || !el?.addEventListener || (el as { __orderClick?: boolean }).__orderClick) return;
    (el as { __orderClick?: boolean }).__orderClick = true;
    el.addEventListener(
      'click',
      (e) => {
        if (draggedAt.current === Number.MAX_SAFE_INTEGER || Date.now() - draggedAt.current < 400) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true
    );
  };
  const cancel = () => {
    draggedAt.current = Date.now();
    setCarried(false);
    live.current.ctl.cancel();
  };
  const base = Gesture.Pan().enabled(enabled);
  // THE LAPTOP (2026-11-03, the user: «перетягування не працює» in Справи): a mouse does not hold-then-drag, it presses and
  // moves - a press that moves a few points is the drag (as the explorer's cards, useExplorerCarry). A click stays a click.
  // The phone: hold, then drag; a sideways move is a row's own swipe (SwipeRow inside), never a drag.
  const pan = (Platform.OS === 'web' ? base.minDistance(6) : base.activateAfterLongPress(320).failOffsetX([-10, 10]))
    .onStart(() => {
      inHand.value = 1;
      lift.value = withTiming(1, { duration: 120 });
      runOnJS(begin)();
    })
    .onUpdate((e) => {
      ty.value = e.translationY;
      runOnJS(move)(e.absoluteY);
    })
    .onEnd(() => {
      runOnJS(markDragged)();
      runOnJS(end)();
    })
    .onFinalize((_e, success) => {
      if (!success) runOnJS(cancel)();
      inHand.value = 0;
      ty.value = 0;
      lift.value = withTiming(0, { duration: 120 });
    });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value + (inHand.value && shift ? shift.value : 0) }, { scale: 1 + lift.value * 0.02 }],
    zIndex: lift.value > 0 ? 10 : 0,
    opacity: 1 - lift.value * 0.15,
  }));
  return (
    <View>
      {carried && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: radius, borderWidth: 1.5, borderStyle: 'dashed', borderColor: outline }}
        />
      )}
      <GestureDetector gesture={pan}>
        <Animated.View
          style={style}
          ref={(node: unknown) => {
            ctl.register(id, node as View | null);
            swallowClick(node);
          }}
          collapsable={false}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
