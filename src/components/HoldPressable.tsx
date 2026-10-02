import { useRef } from 'react';
import { Pressable, View, type PressableProps } from 'react-native';
import { markHeld } from '../utils/heldNode';

// A Pressable whose hold says "this one" before its handler runs, so the
// menu the hold opens lifts it over the blur (heldNode / holdAsk). For the
// odd card drawn inline, without a card component of its own to do it.
export default function HoldPressable({ onLongPress, ...rest }: PressableProps) {
  const node = useRef<View | null>(null);
  return (
    <Pressable
      ref={node}
      {...rest}
      onLongPress={
        onLongPress
          ? (e) => {
              markHeld(node.current);
              onLongPress(e);
            }
          : undefined
      }
    />
  );
}
