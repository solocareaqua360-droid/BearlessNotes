import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { railFreeHeight, useRailLayout } from '../constants/rail';

// Where each thing on the right-hand rail stands, on this screen size.
// One hook so the four components that share the column - the tag button,
// the add button, the navigation island and the tag row itself - all
// agree without measuring one another.
// A screen whose capsule carries a third button passes its height
// (CAPSULE_HEIGHT_3) - everything below the capsule is spaced against it.
// `hasIsland` is false on a screen PUSHED over the tabs, which has no
// navigation island at its foot and so must not reserve room for one.
export function useRail(
  capsuleHeight?: number,
  actionsHeight?: number,
  createHeight?: number,
  historyHeight?: number,
  hasIsland: boolean = true,
  extraHeight: number = 0
) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useRailLayout(
    height,
    insets.top,
    insets.bottom,
    capsuleHeight,
    actionsHeight,
    createHeight,
    historyHeight,
    hasIsland,
    extraHeight
  );
}

// Only the height the stack has to share - asked BEFORE deciding what to
// put on the rail, so a screen can leave out the pieces that would not
// fit rather than let them ride up over its top capsule.
export function useRailFree(capsuleHeight?: number, hasIsland: boolean = true) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return railFreeHeight(height, insets.top, insets.bottom, capsuleHeight, hasIsland).free;
}
