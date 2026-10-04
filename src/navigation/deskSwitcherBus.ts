import { useEffect, useState } from 'react';

// THE TAB SWITCHER'S DOOR FOR THE DOCK (an experiment, 2026-10-03): the
// bar (FloatingIslandTabBar) owns the switcher and registers how to open it
// while the desks are in front; the dock, which lives at the root and
// knows nothing of desks, asks here whether there is one and opens it.
//
// MULTITASK_BEAD switches the whole experiment off - the user wants to try
// a round button left of the search field and may want it back as it was.
// OFF since the second experiment (2026-10-03): the bottom-left corner was
// a stretch on a wide phone, so the open desks hang on a pull-and-hold
// instead (usePullToSearch). Set it true to bring the bead back.
export const MULTITASK_BEAD = false;

// THE THIRD EXPERIMENT (2026-10-04): the switcher takes the round button on
// the RIGHT of the soft dock, and "+" moves inside the search field, at its
// right end - "замість кнопки створення у нас буде кнопка багатозадачності".
// Only where the switcher can open (the desks in front); elsewhere the dock
// is as it was. Set it false to bring "+" back to the round button.
export const MULTITASK_RIGHT = true;

let opener: (() => void) | null = null;
const listeners = new Set<() => void>();

export function registerDeskSwitcher(open: (() => void) | null) {
  opener = open;
  listeners.forEach((l) => l());
}

// True if there was a switcher to open (the desks are in front).
export function openDeskSwitcher(): boolean {
  if (!opener) return false;
  opener();
  return true;
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

// Whether the switcher can be opened from the dock's right button.
export function useDeskSwitcherRight(): boolean {
  const [available, setAvailable] = useState(!!opener);
  useEffect(() => {
    const listener = () => setAvailable(!!opener);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return MULTITASK_RIGHT && available;
}
