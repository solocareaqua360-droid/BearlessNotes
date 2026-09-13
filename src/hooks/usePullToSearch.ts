import { useMemo, useRef } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

// Pull the list down from its top and the search field comes out - the
// gesture every phone home screen has.
//
// Android gives nothing to read from the list itself: at the top it simply
// stops, and the scroll offset never goes negative the way it does on iOS.
// So the pull is WATCHED rather than handled: the pan below is declared
// with manual activation and is never activated, so it only ever sees the
// touches while the list keeps them. The first version asked to run
// "simultaneously" with the list instead - which needs a ref the library
// recognises as a handler, and a plain FlatList's is not one, so the pan
// competed for the touch and won, and the documents stopped scrolling.
// A gesture that never activates cannot take anything away.
export function usePullToSearch(onPull: () => void) {
  // Whether the list is at its top, kept from its own scroll events, and
  // where this drag began - a drag that starts halfway down is scrolling.
  const atTop = useRef(true);
  const startY = useRef(0);
  const startX = useRef(0);
  const armed = useRef(false);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((e) => {
          const touch = e.allTouches[0];
          startY.current = touch?.absoluteY ?? 0;
          startX.current = touch?.absoluteX ?? 0;
          armed.current = atTop.current;
        })
        .onTouchesMove((e) => {
          if (!armed.current) return;
          const touch = e.allTouches[0];
          if (!touch) return;
          const dy = touch.absoluteY - startY.current;
          const dx = Math.abs(touch.absoluteX - startX.current);
          // Down, far enough to be meant, and not a sideways swipe between
          // tabs that happened to drift.
          if (dy > 90 && dx < 60) {
            armed.current = false;
            runOnJS(onPull)();
          }
        })
        .onTouchesUp(() => {
          armed.current = false;
        }),
    [onPull]
  );

  const listProps = {
    scrollEventThrottle: 16,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      atTop.current = e.nativeEvent.contentOffset.y <= 2;
    },
  };

  return { gesture, listProps };
}
