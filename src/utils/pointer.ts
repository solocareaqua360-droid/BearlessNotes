import { Platform } from 'react-native';

// Whether whatever is pointing here can hit a small target - a mouse or a
// trackpad, not a finger. The same question useDensity asks, answered once
// at load, for the places that need it in a constant (a type scale, the
// fonts) rather than in a hook. Always false on the phone; on the web it
// is the browser's own `(pointer: fine)`, true in the Mac application and
// in a laptop's browser.
export const IS_POINTER: boolean =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: fine)').matches;
