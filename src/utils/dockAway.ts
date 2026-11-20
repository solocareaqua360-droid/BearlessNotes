import { useSyncExternalStore } from 'react';
import { makeMutable, withTiming } from 'react-native-reanimated';

// THE WHOLE DOCK STEPS AWAY (2026-10-24, the note's search). Something that takes the dock's own place - the search field
// grows out of the dock's capsule - needs the dock gone, ALL of it: the capsule, the round buttons, the way back. Without
// this the dock's own pieces came and went behind the field each time the keyboard rose and fell. One value fades it (the
// same fade the AI balloon uses, see ContextDock's DockPortal), and `away` stops it catching touches meanwhile.
export const dockAwayCover = makeMutable(0);
let away = false;
const listeners = new Set<() => void>();

export function setDockAway(next: boolean, duration = next ? 120 : 220): void {
  if (away === next) return;
  away = next;
  dockAwayCover.value = withTiming(next ? 1 : 0, { duration });
  listeners.forEach((l) => l());
}

export function useDockAway(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => away,
    () => away
  );
}
