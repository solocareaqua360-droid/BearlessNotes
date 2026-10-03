import { useContext, useEffect, useRef } from 'react';
import type { View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { DeskContext } from './desks';
import { registerDeskContent } from './deskShots';

// For a screen drawn INSIDE a desk that is a navigator (the boards): the
// view its desk's picture should be taken of, while this screen is the one
// in front (see deskShots' registerDeskContent).
export function useDeskContent<T extends View = View>() {
  const ref = useRef<T | null>(null);
  const desk = useContext(DeskContext);
  const focused = useIsFocused();
  const key = desk?.key;
  useEffect(() => {
    if (!key || !focused || !ref.current) return;
    return registerDeskContent(key, ref.current);
  }, [key, focused]);
  return ref;
}
