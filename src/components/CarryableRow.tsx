import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { CardCarry } from '../hooks/useCardCarry';

// Longer than the card's own long-press menu (RN's default delay, 500ms)
// on purpose - the user's own two-hold-length rule: a SHORT hold still
// opens the menu, unchanged; only a hold that outlasts it lifts the card.
// `Gesture.Exclusive` is what makes that possible without racing the two:
// while this Pan is still waiting to activate, the menu's own Pressable
// (wrapped as Gesture.Native() below) is BLOCKED from recognizing
// anything at all, so it cannot fire early. Only once this Pan fails (the
// finger lifted, or moved, before 650ms) does the Pressable get its turn,
// from the same touch-down - which is when a plain tap or a short hold
// does exactly what it always did.
const CARRY_LONG_PRESS_MS = 650;

export default function CarryableRow<T extends { id: string }>({
  item,
  path,
  carry,
  children,
}: {
  item: T;
  // The folder this item is showing under right now - what a cancelled
  // or same-folder drop compares against, and what the toast's undo puts
  // it back to.
  path: string;
  carry: CardCarry<T>;
  children: React.ReactNode;
}) {
  const nodeRef = useRef<View>(null);
  const isCarrying = carry.ghost?.item.id === item.id;
  // The row this item still occupies fades rather than disappears - the
  // floating ghost (see CardCarryOverlay) is a DETACHED visual, because
  // navigating to another folder mid-drag unmounts this row entirely; the
  // fade is only for while it is still on screen to look at.
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withTiming(isCarrying ? 1 : 0, { duration: 150 });
  }, [isCarrying, lift]);
  const style = useAnimatedStyle(() => ({ opacity: 1 - lift.value * 0.6 }));

  const dragGesture = Gesture.Pan()
    .activateAfterLongPress(CARRY_LONG_PRESS_MS)
    .runOnJS(true)
    .onStart((e) => {
      if (nodeRef.current) carry.beginCarry(item, path, nodeRef.current, e.x, e.y);
    })
    .onUpdate((e) => carry.updateCarry(e.absoluteX, e.absoluteY))
    .onEnd(() => carry.endCarry())
    // A safety net, not the usual path: guarantees the ghost never gets
    // stuck on screen however this gesture actually finishes underneath -
    // onEnd already handles both a real drop and a plain cancel.
    .onFinalize(() => carry.cancelCarry());

  return (
    <GestureDetector gesture={Gesture.Exclusive(dragGesture, Gesture.Native())}>
      {/* The measurable node is a PLAIN View, not the Animated one the fade
          runs on: an Animated.View's ref goes through Reanimated's own
          wrapper, which is not guaranteed to answer measureInWindow the
          way a real native view does - this one is only ever asked to
          measure itself, nothing about it animates. */}
      <View ref={nodeRef} collapsable={false}>
        <Animated.View style={style}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}
