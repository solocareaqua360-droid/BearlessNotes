import { useSharedValue } from 'react-native-reanimated';

// A browser has no soft keyboard to ride on - the values stay at zero,
// which is the keyboard-down position, the only one there is here.
export function useKeyboardRide() {
  const height = useSharedValue(0);
  const progress = useSharedValue(0);
  return { height, progress };
}
