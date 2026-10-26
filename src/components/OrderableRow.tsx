import { useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

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
  children,
}: {
  id: string;
  // The rows it is ordered among (its own list, in the order shown).
  ids: string[];
  ctl: OrderControl;
  enabled?: boolean;
  children: ReactNode;
}) {
  const lift = useSharedValue(0);
  const ty = useSharedValue(0);
  // The latest list, read when the drag starts (the gesture is built once per render, the ids change with the data).
  const live = useRef({ ids, ctl });
  live.current = { ids, ctl };
  const begin = () => live.current.ctl.begin(id, live.current.ids);
  const move = (y: number) => live.current.ctl.move(y);
  const end = () => live.current.ctl.end();
  const cancel = () => live.current.ctl.cancel();
  const pan = Gesture.Pan()
    .enabled(enabled)
    .activateAfterLongPress(320)
    .onStart(() => {
      lift.value = withTiming(1, { duration: 120 });
      runOnJS(begin)();
    })
    .onUpdate((e) => {
      ty.value = e.translationY;
      runOnJS(move)(e.absoluteY);
    })
    .onEnd(() => {
      runOnJS(end)();
    })
    .onFinalize((_e, success) => {
      if (!success) runOnJS(cancel)();
      ty.value = 0;
      lift.value = withTiming(0, { duration: 120 });
    });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { scale: 1 + lift.value * 0.02 }],
    zIndex: lift.value > 0 ? 10 : 0,
    opacity: 1 - lift.value * 0.15,
  }));
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style} ref={(node: unknown) => ctl.register(id, node as View | null)} collapsable={false}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
