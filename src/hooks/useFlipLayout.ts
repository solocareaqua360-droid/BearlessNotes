import type { RefObject } from 'react';
import type { View } from 'react-native';

// Cards and folders that flow into a new arrangement when the room around
// them changes slide to their new places instead of jumping - the browser's
// side does the work (useFlipLayout.web); a phone's list has no such moment.
export function useFlipLayout(_scope: RefObject<View | null>, _layoutKey: string): void {}
