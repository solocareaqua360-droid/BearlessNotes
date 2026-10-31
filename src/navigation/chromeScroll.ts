import { useEffect, useMemo, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Easing, makeMutable, withTiming } from 'react-native-reanimated';
import { FEATURES } from '../features';

// THE CHROME STEPS BACK WHILE YOU READ (2026-10-12, the user's: «щоб воно і було, і не заважало перегляду контенту»).
// A screen with a long list feeds its scroll into `makeChromeScroll()`; scrolling DOWN folds the chrome away
// (the bar at the top narrows to its title, the dock keeps only its "+" and circle (a little
// fainter)), scrolling back UP - or reaching the top, or leaving the screen - brings it all back.
// Only opacity moves (no blur, no transforms that outlive the motion): a moving live blur froze the app once, and
// a transform left on a button makes a drifting tap miss it. `chromeCompact` is 0..1 for the animated styles;
// `useChromeCompactFlag` is the boolean the buttons use to stop taking touches while they are folded away.
export const chromeCompact = makeMutable(0);
let flag = false;
const listeners = new Set<() => void>();

export function setChromeCompact(on: boolean) {
  if (on === flag) return;
  flag = on;
  chromeCompact.value = withTiming(on ? 1 : 0, { duration: 240, easing: Easing.out(Easing.cubic) });
  listeners.forEach((l) => l());
}

export function useChromeCompactFlag(): boolean {
  const [on, setOn] = useState(flag);
  useEffect(() => {
    const listener = () => setOn(flag);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return on;
}

// A scroll handler with a little memory: the direction of the last move and where it turned. Folds after 36 points
// further down, unfolds after 20 back up; never folded within 60 of the top.
export function makeChromeScroll() {
  let lastY = 0;
  let dir = 0;
  let anchor = 0;
  return (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const d = y - lastY;
    lastY = y;
    if (y <= 60) {
      setChromeCompact(false);
      dir = 0;
      anchor = y;
      return;
    }
    const next = d > 0 ? 1 : d < 0 ? -1 : dir;
    if (next !== dir) {
      dir = next;
      anchor = y;
    }
    if (dir === 1 && y - anchor > 36) setChromeCompact(true);
    else if (dir === -1 && anchor - y > 20) setChromeCompact(false);
  };
}

// For a screen's list: the handler to hand to its `onScroll` (undefined while the feature is off). Folding is undone
// when the desk in front changes (FloatingIslandTabBar), so a screen needs no focus bookkeeping of its own.
export function useChromeScrollHandler() {
  return useMemo(() => (FEATURES.chromeCompact ? makeChromeScroll() : undefined), []);
}
