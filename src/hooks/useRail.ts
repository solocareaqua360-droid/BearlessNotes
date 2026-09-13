import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRailLayout } from '../constants/rail';

// Where each thing on the right-hand rail stands, on this screen size.
// One hook so the four components that share the column - the tag button,
// the add button, the navigation island and the tag row itself - all
// agree without measuring one another.
// A screen whose capsule carries a third button passes its height
// (CAPSULE_HEIGHT_3) - everything below the capsule is spaced against it.
export function useRail(capsuleHeight?: number) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useRailLayout(height, insets.top, insets.bottom, capsuleHeight);
}
