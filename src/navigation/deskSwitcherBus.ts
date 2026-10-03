import { useEffect, useState } from 'react';

// THE TAB SWITCHER'S DOOR FOR THE DOCK (an experiment, 2026-10-03): the
// bar (FloatingIslandTabBar) owns the switcher and registers how to open it
// while the desks are in front; the dock, which lives at the root and
// knows nothing of desks, asks here whether there is one and opens it.
//
// MULTITASK_BEAD switches the whole experiment off - the user wants to try
// a round button left of the search field and may want it back as it was.
export const MULTITASK_BEAD = true;

let opener: (() => void) | null = null;
const listeners = new Set<() => void>();

export function registerDeskSwitcher(open: (() => void) | null) {
  opener = open;
  listeners.forEach((l) => l());
}

export function openDeskSwitcher() {
  opener?.();
}

export function useDeskSwitcherAvailable(): boolean {
  const [available, setAvailable] = useState(!!opener);
  useEffect(() => {
    const listener = () => setAvailable(!!opener);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return MULTITASK_BEAD && available;
}
