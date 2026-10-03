import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, NativeScrollEvent, NativeSyntheticEvent, StyleProp, View, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { hapticButtonDown } from '../utils/haptics';
import { PULL_MORPH_AT, deskPull, deskPullEnabled } from '../navigation/deskPull';

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
// A long pull, and one you can SEE being pulled: Android's own stretch
// plays out in the first few centimetres, so the buzz used to come while
// the finger still felt it had barely started ("вібро відгук відбувався
// занадто швидко і нема відчуття що ти тягнув"). The list now follows
// the finger itself, with resistance, all the way to the point where
// search opens.
// 280 was liked, then trimmed by a fifth ("трохи меншу ... на 20%").
const PULL_TO_OPEN = 225;
// PULL, THEN HOLD (an experiment, 2026-10-03): the buzz at PULL_TO_OPEN now
// ARMS the search instead of opening it. Let go and the search opens; keep
// the finger where it is for HOLD_MS and the open desks come out instead
// (a second buzz, onHold) - one pull, two meanings, told apart by whether
// the finger stays. Pulling back above the line cancels both.
const HOLD_MS = 550;
// How far the finger may drift and still be "holding"; further than that
// it is pulling on, and the wait starts again.
const HOLD_DRIFT = 28;

// The list's own travel for a pull of `t`: close behind the finger, with
// only a light give towards the end - a rubber band, never a stop. It was
// 0.6 and /400 (about 100 of travel at the trigger), and the user found
// the length right but the pull too heavy ("зусилля ... повинно бути
// легше"); now about 180.
function rubberBand(t: number): number {
  'worklet';
  if (t <= 0) return 0;
  return (t * 0.85) / (1 + t / 900);
}

// `enabled` false: the screen is a surface of its own (a map) that is
// dragged, not a list pulled down past its top.
export function usePullToSearch(
  onPull: () => void,
  enabled = true,
  // Held at the line: true if something opened (false: nothing here to
  // open, and release still means search).
  onHold?: () => boolean | void
) {
  // Shared values, not refs: these are read inside gesture callbacks,
  // which run on the UI thread, where a ref's .current is a copy that
  // neither sees writes from JS nor keeps its own.
  const atTop = useSharedValue(true);
  const armed = useSharedValue(false);
  const fired = useSharedValue(false);
  const pulled = useSharedValue(0);
  // Past the line, waiting to see whether the finger lets go or stays.
  const waiting = useSharedValue(false);
  const waitedAt = useSharedValue(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdRef = useRef(onHold);
  holdRef.current = onHold;
  const stopHold = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);
  const startHold = useCallback(() => {
    stopHold();
    if (!holdRef.current) return;
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      if (!waiting.value || fired.value) return;
      if (holdRef.current?.() === false) return;
      fired.value = true;
      waiting.value = false;
      pulled.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
      pullHaptic();
    }, HOLD_MS);
  }, [stopHold, waiting, fired, pulled]);
  useEffect(() => stopHold, [stopHold]);

  const gesture = useMemo(() => {
    const list = Gesture.Native();
    const pull = Gesture.Pan()
      .enabled(enabled)
      .simultaneousWithExternalGesture(list)
      // Vertical only, and it gives up the moment the finger goes
      // sideways: the pager that carries the tabs is the OTHER gesture
      // this one shares the screen with, and a pan with no direction of
      // its own competes with that too - which is what stopped the
      // sideways swipe. activeOffsetY starts it only on a downward drag;
      // failOffsetX drops it out of the running as soon as the movement
      // reads as horizontal, handing the touch to the pager untouched.
      .activeOffsetY(15)
      .failOffsetX([-20, 20])
      .onBegin(() => {
        armed.value = atTop.value;
        fired.value = false;
        waiting.value = false;
      })
      .onUpdate((e) => {
        if (!armed.value || fired.value) return;
        pulled.value = rubberBand(e.translationY);
        // The bar becomes the panel of open desks as the list comes down.
        if (deskPullEnabled.value) deskPull.value = Math.min(1, pulled.value / PULL_MORPH_AT);
        if (!waiting.value) {
          // Down, far enough that the stretch has already played out, and
          // not a sideways swipe between tabs that sagged a little.
          if (e.translationY > PULL_TO_OPEN && Math.abs(e.translationX) < 80) {
            waiting.value = true;
            waitedAt.value = e.translationY;
            runOnJS(pullHaptic)();
            runOnJS(startHold)();
          }
        } else if (e.translationY < PULL_TO_OPEN - 60) {
          // Pulled back up: neither.
          waiting.value = false;
          runOnJS(stopHold)();
        } else if (Math.abs(e.translationY - waitedAt.value) > HOLD_DRIFT) {
          // Still pulling on: not a hold yet.
          waitedAt.value = e.translationY;
          runOnJS(startHold)();
        }
      })
      .onEnd(() => {
        if (!waiting.value || fired.value) return;
        waiting.value = false;
        fired.value = true;
        runOnJS(stopHold)();
        // Home straight away: opening search swaps the list out from
        // under this gesture, and a detector that is gone never gets
        // its finalize - the list came back still pulled down, the
        // tiles stuck below their place.
        pulled.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
        runOnJS(onPull)();
      })
      .onFinalize(() => {
        armed.value = false;
        waiting.value = false;
        runOnJS(stopHold)();
        pulled.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
        // Back to a bar - unless it was held open, which the switcher keeps
        // in hand itself (its own open state).
        deskPull.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
      });
    return Gesture.Simultaneous(list, pull);
  }, [onPull, enabled, startHold, stopHold]);

  // Put on a view AROUND the list's gesture detector (not on the list
  // itself - the detector has to sit directly on the list).
  const pullStyle = useAnimatedStyle(() => ({ transform: [{ translateY: pulled.value }] }));

  // How far the list has been scrolled, on the UI thread - what the
  // backdrop drifts by, so the glass over it has something moving to
  // blur. Every list already reports its offset here for the pull; this
  // is the same number, kept.
  const scrollY = useSharedValue(0);

  const listProps = {
    // A tap on anything that is not a card, and a drag of the list itself,
    // both put the keyboard away - which is what closes an empty field
    // (see useSearchDismissal). Taps on a card still reach the card.
    keyboardShouldPersistTaps: 'handled' as const,
    keyboardDismissMode: 'on-drag' as const,
    scrollEventThrottle: 16,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      atTop.value = y <= 2;
      scrollY.value = y;
    },
  };

  return { gesture, listProps, scrollY, pullStyle };
}

// The empty screen under an open, still empty search: a tap or a swipe
// anywhere on it puts the keyboard away and closes the search ("після
// зворотнього свайпа по екрану або просто тапа ... пошук повинен
// пропадати"). A plain View there caught neither.
export function SearchVoid({ onClose, style }: { onClose: () => void; style?: StyleProp<ViewStyle> }) {
  const gesture = useMemo(() => {
    const close = () => {
      Keyboard.dismiss();
      onClose();
    };
    return Gesture.Race(
      Gesture.Tap().runOnJS(true).onEnd(close),
      Gesture.Pan().runOnJS(true).minDistance(12).onEnd(close)
    );
  }, [onClose]);
  return (
    <GestureDetector gesture={gesture}>
      <View style={style} collapsable={false} />
    </GestureDetector>
  );
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

// Whether the keyboard is up. The screen clears itself only while it is:
// with the keyboard down the search field is a field like any other, and
// the buttons around it have to be reachable again.
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return visible;
}
