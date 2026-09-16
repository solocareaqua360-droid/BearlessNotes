import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { CardCarry } from '../hooks/useCardCarry';

// Longer than a plain short hold - the user's own two-hold-length rule:
// a short one still opens the menu, a longer one lifts the card.
const CARRY_LONG_PRESS_MS = 650;
// What "short" means for the menu - long enough that a normal tap or a
// quick scroll flick never reaches it, short enough to stay well clear
// of CARRY_LONG_PRESS_MS.
const MENU_HOLD_MS = 380;

// The FIRST version of this composed `Gesture.Exclusive(dragPan,
// Gesture.Native())`, reasoning that Exclusive would keep the card's own
// Pressable long-press from firing until the drag Pan either won the
// touch or failed. It didn't: `Gesture.Native()` hands the touch to the
// wrapped view's OWN Pressability, which is not a gesture-handler
// recognizer and runs on its own independent ~500ms timer no matter what
// a sibling gesture is doing - so the menu kept opening before the drag
// could ever activate ("меню вискакує раніше").
//
// The actual fix does not try to referee two independent timers against
// each other. The card KEEPS its own Pressable (onPress still fires
// natively, untouched - so does every button already inside the row: the
// "..." menu, a tag chip, the select checkbox, each its OWN nested
// Pressable RN already lets win over the row's outer one). The one thing
// removed is the ROW'S OWN onLongPress - that was the entire source of
// the race. In its place, this Pan gesture - the exact
// `activateAfterLongPress` technique already proven here for the note
// editor's own block reorder - times its OWN failure: if it never
// reaches CARRY_LONG_PRESS_MS but the finger was still down past
// MENU_HOLD_MS, that IS the short hold, and the menu opens then. A touch
// shorter than that was a plain tap, which Pressable's own onPress
// already handled through Gesture.Native() below - nothing further to
// do.
export default function CarryableRow<T extends { id: string }>({
  item,
  path,
  carry,
  onMenu,
  children,
}: {
  item: T;
  // The folder this item is showing under right now - what a cancelled
  // or same-folder drop compares against, and what the toast's undo puts
  // it back to.
  path: string;
  carry: CardCarry<T>;
  // What the row's own onLongPress used to do directly - now gated by
  // this gesture's own timing instead of racing it. Pass the SAME
  // callback the row's onLongPress had, and drop onLongPress from the
  // row itself (see this file's own note on why).
  onMenu: () => void;
  children: React.ReactNode;
}) {
  const nodeRef = useRef<View>(null);
  const isCarrying = carry.ghost?.item.id === item.id;
  // The row this item still occupies fades rather than disappears - the
  // floating ghost (see CardCarryOverlay) is a DETACHED visual, because
  // navigating to another folder mid-drag can unmount this row entirely;
  // the fade is only for while it is still on screen to look at.
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withTiming(isCarrying ? 1 : 0, { duration: 150 });
  }, [isCarrying, lift]);
  const style = useAnimatedStyle(() => ({ opacity: 1 - lift.value * 0.6 }));

  const downAt = useRef(0);

  const dragGesture = Gesture.Pan()
    .activateAfterLongPress(CARRY_LONG_PRESS_MS)
    .runOnJS(true)
    .onBegin(() => {
      downAt.current = Date.now();
    })
    .onStart((e) => {
      if (nodeRef.current) carry.beginCarry(item, path, nodeRef.current, e.x, e.y);
    })
    .onUpdate((e) => carry.updateCarry(e.absoluteX, e.absoluteY))
    .onEnd((_e, success) => {
      if (success) {
        carry.endCarry();
      } else if (Date.now() - downAt.current >= MENU_HOLD_MS) {
        onMenu();
      }
    })
    // A safety net, not the usual path: guarantees the ghost never gets
    // stuck on screen however this gesture actually finishes underneath.
    .onFinalize(() => carry.cancelCarry());

  return (
    <GestureDetector gesture={Gesture.Simultaneous(dragGesture, Gesture.Native())}>
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
