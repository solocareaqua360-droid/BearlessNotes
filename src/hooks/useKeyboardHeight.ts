import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

// The keyboard's height while it is up, 0 while it is not.
//
// KeyboardProvider (App.tsx) puts the window edge-to-edge and takes away
// the resize Android used to do under a keyboard - so nothing moves out of
// the keyboard's way on its own any more, and a sheet that does not track
// it gets its input covered. Every sheet with a field used to carry its
// own copy of these two listeners, or none, which is how the covered-input
// bug kept coming back one sheet at a time. This is the one copy; a sheet's
// backdrop pads its bottom by this much, so the sheet is centred in what
// the keyboard leaves and a percentage maxHeight shrinks with it.
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  return height;
}
