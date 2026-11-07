import { useSyncExternalStore } from 'react';

// THE MAC'S COMPOSER, open or folded to its «+» (2026-10-31, the user's: it must unfold from the plus, not hang there for ever, and the
// sidebar's «Новий» unfolds it too). One flag for the window; the composer reads it, the sidebar and the screens set it.
let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const composerBus = {
  open() {
    if (open) {
      emit();
      return;
    }
    open = true;
    emit();
  },
  close() {
    if (!open) return;
    open = false;
    emit();
  },
  toggle() {
    open = !open;
    emit();
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useComposerOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open);
}
