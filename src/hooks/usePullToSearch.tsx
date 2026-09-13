import { useEffect, useMemo } from 'react';
import { Keyboard, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { hapticButtonDown } from '../utils/haptics';

// Pull the list down from its top and the search field comes out - but
// only after the cards have stretched first, the way they do when a list
// is pulled past its end. A short tug is just that: the list springs back
// and nothing opens.
//
// How this has to be built, after two wrong turns:
// - The native refresh gesture (what this used before) works, but it EATS
//   the pull: the ring takes over and the cards never stretch at all.
// - A pan of our own given the list's ref does not work: the library does
//   not recognise a plain ScrollView ref as a gesture, so the declaration
//   is ignored, the pan competes for the touch and wins, and the list
//   stops scrolling entirely.
// The way that does work is to declare the list itself as a gesture
// (Gesture.Native) and run the pan SIMULTANEOUSLY with it. The list keeps
// every touch and goes on scrolling and stretching exactly as before; the
// pan only measures alongside it.
const PULL_TO_OPEN = 140;

export function usePullToSearch(onPull: () => void) {
  // Shared values, not refs: these are read inside gesture callbacks,
  // which run on the UI thread, where a ref's .current is a copy that
  // neither sees writes from JS nor keeps its own.
  const atTop = useSharedValue(true);
  const armed = useSharedValue(false);
  const fired = useSharedValue(false);

  const gesture = useMemo(() => {
    const list = Gesture.Native();
    const pull = Gesture.Pan()
      .simultaneousWithExternalGesture(list)
      .onBegin(() => {
        armed.value = atTop.value;
        fired.value = false;
      })
      .onUpdate((e) => {
        if (!armed.value || fired.value) return;
        // Down, far enough that the stretch has already played out, and
        // not a sideways swipe between tabs that sagged a little.
        if (e.translationY > PULL_TO_OPEN && Math.abs(e.translationX) < 80) {
          fired.value = true;
          runOnJS(onPull)();
        }
      })
      .onFinalize(() => {
        armed.value = false;
      });
    return Gesture.Simultaneous(list, pull);
  }, [onPull]);

  const listProps = {
    // A tap on anything that is not a card, and a drag of the list itself,
    // both put the keyboard away - which is what closes an empty field
    // (see useSearchDismissal). Taps on a card still reach the card.
    keyboardShouldPersistTaps: 'handled' as const,
    keyboardDismissMode: 'on-drag' as const,
    scrollEventThrottle: 16,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      atTop.value = e.nativeEvent.contentOffset.y <= 2;
    },
  };

  return { gesture, listProps };
}

// Opening it is a gesture; closing it is everything else.
export function useSearchDismissal({
  isSearching,
  query,
  isFocused,
  close,
}: {
  isSearching: boolean;
  query: string;
  isFocused: boolean;
  close: () => void;
}) {
  useEffect(() => {
    if (!isSearching) return;
    const subscription = Keyboard.addListener('keyboardDidHide', () => {
      if (query.trim().length === 0) close();
    });
    return () => subscription.remove();
  }, [isSearching, query, close]);

  useEffect(() => {
    if (!isFocused && isSearching) {
      Keyboard.dismiss();
      close();
    }
  }, [isFocused, isSearching, close]);
}

export function pullHaptic() {
  hapticButtonDown();
}
