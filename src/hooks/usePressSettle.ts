import { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';

// A CARD THAT SETTLES under the finger (the soft motion's press, on the
// phone - the laptop's is one CSS rule, see the .web sibling): a touch
// presses it down a little, letting go lets it back. Spread `handlers` on
// the card's Pressable and put `style` on an Animated.View around it.
const DOWN = 0.97;
const EASE = Easing.bezier(0.22, 1, 0.36, 1);

export function usePressSettle() {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const handlers = {
    onPressIn: () => {
      scale.value = withTiming(DOWN, { duration: 90, easing: EASE });
    },
    onPressOut: () => {
      scale.value = withTiming(1, { duration: 160, easing: EASE });
    },
  };
  return { style, handlers };
}
