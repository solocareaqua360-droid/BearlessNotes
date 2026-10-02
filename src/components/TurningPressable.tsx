import { forwardRef } from 'react';
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type View, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { usePressSettle } from '../hooks/usePressSettle';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// A CARD THAT IS ITS OWN PRESSABLE and turns over when it opens
// (utils/flipOpen): the press settles it, and the same transform turns it
// on the flip's clock. The pressed view is the whole card, so the press
// event already names what to measure - nothing to wrap, no layout moved.
type Props = Omit<PressableProps, 'style'> & {
  cardKey: string;
  dimmed?: boolean;
  style?: StyleProp<ViewStyle>;
};

const TurningPressable = forwardRef<View, Props>(function TurningPressable(
  { cardKey, dimmed, style, onPressIn, onPressOut, ...rest },
  ref
) {
  const settle = usePressSettle(cardKey, dimmed);
  return (
    <AnimatedPressable
      ref={ref as never}
      {...rest}
      style={[style, settle.style]}
      onPressIn={(e: GestureResponderEvent) => {
        settle.handlers.onPressIn?.();
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        settle.handlers.onPressOut?.();
        onPressOut?.(e);
      }}
    />
  );
});

export default TurningPressable;
