import { RefObject } from 'react';
import { View } from 'react-native';

// The right mouse button, where there is one. A phone has no such thing
// and holds a card instead, so this does nothing there - the whole
// implementation is in the .web sibling.
export function useContextMenu(
  _ref: RefObject<View | null>,
  _onOpen: (x: number, y: number) => void
): void {}
