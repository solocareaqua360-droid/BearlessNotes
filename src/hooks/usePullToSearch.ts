import { useMemo, useRef } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

// Pull the list down from its top and the search field comes out - the
// gesture every phone home screen has.
//
// Android gives no bounce to read: a list at the top simply stops, and
// contentOffset never goes negative the way it does on iOS. So the pull is
// watched by a pan of its own, declared SIMULTANEOUS with the list's own
// scrolling rather than competing with it. That matters: the two never
// fight, and if the gesture fails to recognise anything at all, the worst
// that happens is the search does not open - the list still scrolls.
export function usePullToSearch(onPull: () => void) {
  // Whether the list is at its top, kept from its own scroll events, and
  // whether it was at the top when THIS drag began - a drag that starts
  // halfway down the list is scrolling, not a pull.
  const atTop = useRef(true);
  const startedAtTop = useRef(false);
  const listRef = useRef(null);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .simultaneousWithExternalGesture(listRef)
        .onBegin(() => {
          startedAtTop.current = atTop.current;
        })
        .onEnd((e) => {
          // Down, far enough to be meant, and not a sideways swipe between
          // tabs that happened to drift.
          if (startedAtTop.current && e.translationY > 90 && Math.abs(e.translationX) < 60) {
            runOnJS(onPull)();
          }
        }),
    [onPull]
  );

  const listProps = {
    ref: listRef,
    scrollEventThrottle: 16,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      atTop.current = e.nativeEvent.contentOffset.y <= 2;
    },
  };

  return { gesture, listProps };
}
