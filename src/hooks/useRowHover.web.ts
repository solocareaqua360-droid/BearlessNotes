import { useEffect, useRef, useState } from 'react';
import type { View } from 'react-native';

// Hover on a node, told through the DOM: React Native Web's own hover
// callbacks do not fire for a View that is not a Pressable. RNW gives a
// View's ref as the DOM node.
export function useRowHover(): [React.RefObject<View | null>, boolean] {
  const ref = useRef<View | null>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const on = () => setHover(true);
    const off = () => setHover(false);
    node.addEventListener('mouseenter', on);
    node.addEventListener('mouseleave', off);
    return () => {
      node.removeEventListener('mouseenter', on);
      node.removeEventListener('mouseleave', off);
    };
  }, []);
  return [ref, hover];
}
