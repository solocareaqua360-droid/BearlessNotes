import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { CardCarry } from '../hooks/useCardCarry';

// A card that can be picked up and carried into a folder.
//
// It holds no gesture. The long-press-then-drag lives on the LIST (see
// useCardCarry's own note on why it had to move there), and this only
// hands its node over so the list can tell what the finger is on, and
// fades while its own item is the one in hand. That is also why nothing
// here has to survive being unmounted any more: the gesture is not this
// row's to lose.
export default function CarryableRow<T extends { id: string }>({
  item,
  carry,
  onMenu,
  group,
  children,
}: {
  item: T;
  carry: CardCarry<T>;
  // What this row's own short hold opens - the menu its onLongPress used
  // to open directly, before the list started deciding which hold is
  // which.
  onMenu: () => void;
  // What this row picks up: itself, or - when it is one of several ticked
  // - all of them, so a bulk move is the same gesture rather than a
  // second way of doing it.
  group?: T[];
  children: React.ReactNode;
}) {
  const isCarrying = !!carry.ghost?.items.some((one) => one.id === item.id);
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withTiming(isCarrying ? 1 : 0, { duration: 150 });
  }, [isCarrying, lift]);
  const style = useAnimatedStyle(() => ({ opacity: 1 - lift.value * 0.6 }));

  return (
    <View
      // A PLAIN View, not the Animated one the fade runs on: an
      // Animated.View's ref goes through Reanimated's own wrapper, which
      // is not guaranteed to answer measureInWindow the way a real native
      // view does - and measuring is this node's whole job.
      ref={carry.registerCard(item.id, () => group ?? [item], onMenu)}
      collapsable={false}
    >
      <Animated.View style={style}>{children}</Animated.View>
    </View>
  );
}
