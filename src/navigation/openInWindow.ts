import { Platform } from 'react-native';
import { FEATURES } from '../features';
import type { PaneTarget } from './paneTarget';
import { windowUrlFor } from './paneTargetInfo';

// «У ВІКНО» (2026-10-30, the user's: a right-click on a note, a board or a base of one's own): the Mac's shell opens the
// same app at an address that says what to open (App.web's `open` parameter). Only where there is a window to open.
export const CAN_OPEN_IN_WINDOW = Platform.OS === 'web' && FEATURES.macFrameB;

export function openInWindow(target: PaneTarget): void {
  if (CAN_OPEN_IN_WINDOW) window.open(windowUrlFor(target), '_blank');
}
