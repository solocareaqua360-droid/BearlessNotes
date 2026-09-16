import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
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

// Two versions of this got the arbitration wrong, both by putting the
// card's own Pressable INTO the composition:
//
//   1. `Gesture.Exclusive(dragPan, Gesture.Native())` - the hope was that
//      Exclusive would hold the Pressable's own long-press back until the
//      Pan won or failed. It cannot: Gesture.Native() hands the touch to
//      the wrapped view's own Pressability, which is not a gesture-handler
//      recognizer at all, so RNGH has nothing to hold back. The Pressable
//      kept firing its own ~500ms long-press and the menu opened before a
//      drag could ever start ("меню вискакує раніше").
//   2. `Gesture.Simultaneous(dragPan, Gesture.Native())` with the row's
//      onLongPress removed. The menu stopped jumping the queue, but the
//      drag STILL never activated - a hold of any length simply ended as
//      the short one ("тримаю, відпускаючи зʼявляється меню"). Running a
//      native-view handler alongside it is what kept the Pan from ever
//      reaching its own long-press.
//
// So the Pressable is out of the composition entirely: this is the bare
// `Gesture.Pan().activateAfterLongPress(...)`, exactly as the note
// editor's own block reorder uses it for an ordinary row - and that
// screen is the proof that nesting stays intact underneath it, because a
// checkbox block's own checkbox, and a block's own tap-to-edit, are both
// plain Pressables inside a row wrapped in nothing but this same gesture,
// and both have worked on the device for months.
//
// What this gesture then owns is only the ROW'S OWN long press: the row
// keeps its onPress (a plain tap still opens the item) and every button
// nested in it (the "..." menu, a tag chip, the select checkbox), and
// gives up only onLongPress - which this one times itself. Fails to
// reach CARRY_LONG_PRESS_MS but the finger was down past MENU_HOLD_MS:
// that IS the short hold, so the menu opens, on this gesture's own clock
// rather than racing a second one.
const styles = StyleSheet.create({
  // Kept in the tree, kept out of the layout - see `orphan`.
  orphan: {
    height: 0,
    opacity: 0,
    overflow: 'hidden',
  },
});

export default function CarryableRow<T extends { id: string }>({
  item,
  path,
  carry,
  onMenu,
  orphan,
  group,
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
  // This row's item is no longer part of the list being shown - the
  // second finger stepped into another folder while the card was up. It
  // has to stay MOUNTED anyway: the drag gesture belongs to this view, and
  // unmounting it mid-carry orphans the whole gesture (no release ever
  // arrives, the ghost sticks, and the carry overlay goes on swallowing
  // every touch on the screen - which read as the app freezing). So it
  // stays, taking no room and drawing nothing.
  orphan?: boolean;
  // What this row actually picks up. Just its own item, normally - the
  // whole tick-box selection when this row is part of one, so a bulk move
  // is the same gesture rather than a second way of doing it.
  group?: T[];
  children: React.ReactNode;
}) {
  const nodeRef = useRef<View>(null);
  const isCarrying = !!carry.ghost?.items.some((one) => one.id === item.id);
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
      if (nodeRef.current) carry.beginCarry(group ?? [item], path, nodeRef.current, e.x, e.y);
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
    <GestureDetector gesture={dragGesture}>
      {/* The measurable node is a PLAIN View, not the Animated one the fade
          runs on: an Animated.View's ref goes through Reanimated's own
          wrapper, which is not guaranteed to answer measureInWindow the
          way a real native view does - this one is only ever asked to
          measure itself, nothing about it animates. */}
      <View ref={nodeRef} collapsable={false} style={orphan ? styles.orphan : undefined}>
        <Animated.View style={style}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}
