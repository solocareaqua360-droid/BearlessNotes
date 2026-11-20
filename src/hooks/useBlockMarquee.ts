import type { RefObject } from 'react';
import type { View } from 'react-native';

// Picking blocks by dragging the mouse across them - a laptop's (see the
// .web sibling). Nothing to do where there is no mouse.
export function useBlockMarquee(_container: RefObject<View | null>, _enabled: boolean, _onSelect: (ids: string[]) => void, _onClear?: () => void) {}

// Set for a moment after a drag-selection ends, so the release that ends it
// is not also read as a tap on the block under the pointer.
export function dragSelectJustEnded(): boolean {
  return false;
}
