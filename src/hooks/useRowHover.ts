import { useRef } from 'react';
import type { View } from 'react-native';

// Whether the pointer is over a row - only a laptop has one (see the .web
// sibling). Where there is no pointer it is never over anything.
export function useRowHover(): [React.RefObject<View | null>, boolean] {
  const ref = useRef<View | null>(null);
  return [ref, false];
}
