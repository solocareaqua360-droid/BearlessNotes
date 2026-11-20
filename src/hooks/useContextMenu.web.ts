import { RefObject, useEffect } from 'react';
import { View } from 'react-native';

// Holding a card down is a phone's answer to "what can I do with this",
// and on a laptop it is simply wrong: the hand expects the right button,
// and waiting half a second for a menu feels like the app is thinking.
//
// So the board takes the browser's own contextmenu event - the same one
// that would otherwise open Chrome's "Reload / Save as", which is never
// what someone right-clicking a card on a board wanted.
export function useContextMenu(
  ref: RefObject<View | null>,
  onOpen: (x: number, y: number) => void
): void {
  useEffect(() => {
    // On React Native Web a View's ref IS the DOM node.
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;

    function onContextMenu(event: MouseEvent) {
      event.preventDefault();
      const rect = node!.getBoundingClientRect();
      onOpen(event.clientX - rect.left, event.clientY - rect.top);
    }

    node.addEventListener('contextmenu', onContextMenu);
    return () => node.removeEventListener('contextmenu', onContextMenu);
  }, [ref, onOpen]);
}
