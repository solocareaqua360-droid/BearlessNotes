import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { GlassPortal } from './GlassPortal';

// THE SECOND FINGER while something is carried (hooks/useDragScroll) - the explorer's CardCarryOverlay trick, without its
// ghost and folders: a layer over the screen that is touchable only during a carry, so a second finger landing then is a
// fresh touch of its own (one pointer is enough - the carrying finger began before this layer existed and never
// reaches it) and scrolls the list by how far it moves.
export default function DragScrollOverlay({ active, onScrollBy }: { active: boolean; onScrollBy: (dy: number) => void }) {
  const last = useRef(0);
  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .runOnJS(true)
    .onStart(() => {
      last.current = 0;
    })
    .onUpdate((e) => {
      onScrollBy(e.translationY - last.current);
      last.current = e.translationY;
    });
  return (
    <GlassPortal priority={10}>
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill} pointerEvents={active ? 'auto' : 'none'} />
      </GestureDetector>
    </GlassPortal>
  );
}
