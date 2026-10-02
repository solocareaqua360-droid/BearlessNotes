import { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { flipKey, flipProgress } from '../utils/flipOpen';

// A CARD THAT SETTLES under the finger (the soft motion's press, on the
// phone - the laptop's is one CSS rule, see the .web sibling): a touch
// presses it down a little, letting go lets it back. Spread `handlers` on
// the card's Pressable and put `style` on an Animated.View around it.
//
// Given the card's key, the same style also TURNS the card when it opens
// (utils/flipOpen): edge-on over the first half of the clock, lifting a
// little, then out of sight while the window comes round - one transform,
// so the press and the turn never fight over it.
const DOWN = 0.97;
const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const PERSPECTIVE = 1100;

export function usePressSettle(cardKey?: string) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => {
    const mine = cardKey !== undefined && flipKey.value === cardKey;
    const p = mine ? flipProgress.value : 0;
    const k = Math.min(1, p * 2);
    return {
      opacity: mine && p >= 0.5 ? 0 : 1,
      transform: [{ perspective: PERSPECTIVE }, { rotateY: `${k * 90}deg` }, { scale: scale.value * (1 + 0.06 * k) }],
    };
  });
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
