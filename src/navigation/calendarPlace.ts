import { useSyncExternalStore } from 'react';

// THE CALENDAR'S DAY, told to whoever draws the composer beside it (the Mac's frame B, 2026-10-19), and the one request
// it takes - «create here» (the composer's click). The same shape as explorerPlace: the screen owns the state, this is
// a mirror and a mailbox, so the composer never reaches into the screen.
let day = '';
let createWanted = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const calendarPlace = {
  report(label: string) {
    if (day === label) return;
    day = label;
    emit();
  },
  requestCreate() {
    createWanted = true;
    emit();
  },
  takeCreate(): boolean {
    const c = createWanted;
    createWanted = false;
    return c;
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useCalendarDay(): string {
  return useSyncExternalStore(subscribe, () => day);
}

export function useCalendarCreateWanted(): boolean {
  return useSyncExternalStore(subscribe, () => createWanted);
}
