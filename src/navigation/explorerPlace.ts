import { useSyncExternalStore } from 'react';

// WHERE THE EXPLORER STANDS, told to whoever draws navigation beside it (the Mac's Sidebar), and the way to send it
// somewhere (2026-10-19, frame B). The explorer owns its `path` state; this is only a mirror of it and a mailbox
// for one request, so the sidebar never has to reach into the screen.
let current = '';
let wanted: string | null = null;
// «Новий» from the sidebar: the explorer opens its quick-create window on the next take.
let createWanted = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const explorerPlace = {
  // The explorer says where it is (on every change of its path).
  report(path: string) {
    if (current === path) return;
    current = path;
    emit();
  },
  // Someone asks the explorer to stand at a path; the explorer takes it (`take`) when it is mounted and focused.
  request(path: string) {
    wanted = path;
    emit();
  },
  take(): string | null {
    const p = wanted;
    wanted = null;
    return p;
  },
  get wanted() {
    return wanted;
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
  get createWanted() {
    return createWanted;
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useExplorerPath(): string {
  return useSyncExternalStore(subscribe, () => current);
}

export function useExplorerWanted(): string | null {
  return useSyncExternalStore(subscribe, () => wanted);
}

export function useExplorerCreateWanted(): boolean {
  return useSyncExternalStore(subscribe, () => createWanted);
}
