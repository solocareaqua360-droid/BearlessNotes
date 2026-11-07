import { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { flipKey, flipProgress } from "@/utils/flipOpen";

const DOWN = 0.97;
const PERSPECTIVE = 1100;
const EASE = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * A card that settles under the finger (0.97) and, when it is the card being
 * opened, turns edge-on and lifts 6% in the first half of the flip clock.
 */
export function useTurningCard(cardKey: string) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => {
    const mine = flipKey.value === cardKey;
    const p = mine ? flipProgress.value : 0;
    const k = Math.min(1, p * 2);
    return {
      opacity: mine && p >= 0.5 ? 0 : 1,
      transform: [{ perspective: PERSPECTIVE }, { rotateY: `${k * 90}deg` }, { scale: scale.value * (1 + 0.06 * k) }],
    };
  }, [cardKey]);
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
