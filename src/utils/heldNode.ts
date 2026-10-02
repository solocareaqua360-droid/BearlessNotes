import { useRef } from 'react';
import type { View } from 'react-native';

// WHAT A FINGER IS HOLDING, for the moment right after the hold. A menu a
// hold opens is the chat's gesture everywhere (holdAsk, CardMenu): the
// thing held is lifted sharp over a blurred screen and the menu opens
// beside it. The menu itself knows nothing of cards; it asks this, the
// way a right click's menu asks contextPoint where the pointer was - and
// gets a node only if the hold was just now, so a confirmation that comes
// after a choice is not mistaken for one.

let last: { node: View; at: number } | null = null;

export function markHeld(node: View | null | undefined): void {
  last = node ? { node, at: Date.now() } : null;
}

// Handed out once: the first menu after the hold takes it.
export function takeHeldNode(): View | null {
  if (!last || Date.now() - last.at > 900) return null;
  const node = last.node;
  last = null;
  return node;
}

// For a card: a ref for the thing a finger holds, and its hold handler
// wrapped to say so first. `undefined` stays `undefined` - a card with no
// hold must not grow one.
export function useHeld<T extends View = View>() {
  const ref = useRef<T | null>(null);
  const wrap = (handler: (() => void) | undefined) =>
    handler
      ? () => {
          markHeld(ref.current);
          handler();
        }
      : undefined;
  return { ref, wrap };
}
