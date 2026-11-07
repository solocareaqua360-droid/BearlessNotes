import { useContext, useEffect, useRef } from 'react';
import type { View } from 'react-native';
import { DeskContext } from './desks';
import { registerDeskContent } from './deskShots';

// For a screen drawn INSIDE a desk: the view its desk's picture should be
// taken of (see deskShots' registerDeskContent). Registered for as long as
// the screen is mounted - NOT only while it is focused: the desks are
// photographed ahead, while they stand behind the one in front, and a
// screen in a desk that is not in front never counts as focused, so it
// never registered and every desk was taken through its wrapper (the
// boards' black one included - the diagnostic showed «обгортка» on all,
// 2026-10-04). Within a desk the screen mounted last (an open board over
// the boards list) wins, and the one under it is used again when it goes.
export function useDeskContent<T extends View = View>() {
  const ref = useRef<T | null>(null);
  const desk = useContext(DeskContext);
  const key = desk?.key;
  useEffect(() => {
    if (!key || !ref.current) return;
    return registerDeskContent(key, ref.current);
  }, [key]);
  return ref;
}
