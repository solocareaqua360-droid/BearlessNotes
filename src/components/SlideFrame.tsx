import { ReactNode, useEffect, useRef } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { coverBelow } from '../utils/belowCover';

type Nav = {
  addListener: ((event: 'beforeRemove', cb: (e: { preventDefault: () => void; data: { action: { type: string } } }) => void) => () => void) &
    ((event: 'transitionEnd', cb: (e: { data: { closing: boolean } }) => void) => () => void);
  dispatch: (action: never) => void;
  setOptions: (options: object) => void;
};

// OPENED FROM A LIST ROW (2026-10-25, the user: «анімація відкриття/закриття в режимі списку для дошок і документів - це
// виїзд з правої частини екрану, закриття - виїзд у ліву частину»): the screen arrives from the right (the navigator's own
// slide, see AppNavigator), and on the way back it goes on to the LEFT - not back where it came from - while the list
// under it stays drawn (a transparent modal). The grid's grow-from-the-card (MorphFrame) is unchanged.
const OUT_MS = 280;

export default function SlideFrame({ navigation, children }: { navigation: Nav; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  const passing = useRef(false);
  // Arrived: the list under the screen stops being drawn (utils/belowCover) until the way back.
  const handBack = useRef<(() => Promise<void>) | null>(null);
  useEffect(
    () =>
      navigation.addListener('transitionEnd', (e) => {
        if (!e.data.closing && !passing.current && !handBack.current) handBack.current = coverBelow();
      }),
    [navigation]
  );
  useEffect(() => () => void handBack.current?.(), []);
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (passing.current) return;
        const type = e.data.action.type;
        if (type !== 'GO_BACK' && type !== 'POP') return;
        e.preventDefault();
        passing.current = true;
        const action = e.data.action;
        const leave = () => {
          navigation.setOptions({ animation: 'none' });
          // The options take a frame to reach the native screen: the pop waits for it.
          requestAnimationFrame(() => navigation.dispatch(action as never));
        };
        // The list first, laid out again under the screen, then the screen goes to the left over it.
        const listBack = handBack.current?.() ?? Promise.resolve();
        handBack.current = null;
        listBack.then(() => {
          x.value = withTiming(-width, { duration: OUT_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
            if (finished) runOnJS(leave)();
          });
        });
      }),
    [navigation, width, x]
  );
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return <Animated.View style={[StyleSheet.absoluteFill, style]}>{children}</Animated.View>;
}
