import { useSyncExternalStore } from 'react';

// THE INSPECTOR'S DOOR (the Mac's frame B, 2026-10-19, after Craft): the right panel is opened and closed by one
// button at the end of the window toolbar, and the choice is remembered on this machine. The panel's CONTENT is
// whatever the screen in front publishes (navRail's usePublishRailPanel); this only says whether it is shown.
const KEY = 'mindeva.inspector';
let open = (() => {
  try {
    return typeof localStorage === 'undefined' ? true : localStorage.getItem(KEY) !== 'closed';
  } catch {
    return true;
  }
})();
const listeners = new Set<() => void>();

export const inspector = {
  get open() {
    return open;
  },
  set(next: boolean) {
    if (open === next) return;
    open = next;
    try {
      localStorage.setItem(KEY, next ? 'open' : 'closed');
    } catch {
      // A private window: the choice lives for this session only.
    }
    listeners.forEach((l) => l());
  },
  toggle() {
    inspector.set(!open);
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useInspectorOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open);
}
