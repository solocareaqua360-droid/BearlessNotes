import { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';

// THE CARDS AFTER THE WAY IN (2026-11-16, the optimisation pass, measured: a base's first cards were built while its
// screen was still sliding in - 20-37% of the frames of the way in dropped, 80-270 ms of the thread). False while a pushed
// screen slides in, true from the moment the slide is over (or a little later if no slide is announced). A screen that
// does not slide (a desk, a pane) passes `slides` false and is settled from the start.
export function useSlideSettled(slides: boolean): boolean {
  const navigation = useNavigation();
  const [settled, setSettled] = useState(!slides);
  useEffect(() => {
    if (settled) return;
    const done = () => setSettled(true);
    const off = navigation.addListener('transitionEnd' as never, done);
    const timer = setTimeout(done, 420);
    return () => {
      off();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return settled;
}
