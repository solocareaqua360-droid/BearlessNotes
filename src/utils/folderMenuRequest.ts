import { useEffect, useRef } from 'react';

// «МЕНЮ ПАПКИ З САЙДБАРУ» (2026-10-31, the laptop's right click): the sidebar's folder row asks the explorer to open the
// same menu its own folder cards have (rename, move, colour, delete…) - one menu, not a second copy of it. When the
// explorer is not in front, the request waits for it: `wait` takes the person there first.
let handler: ((path: string) => void) | null = null;
let pending: string | null = null;

export function requestFolderMenu(path: string, wait: () => void): void {
  if (handler) handler(path);
  else {
    pending = path;
    wait();
  }
}

export function useFolderMenuRequests(fn: (path: string) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = (path: string) => ref.current(path);
    handler = h;
    if (pending) {
      const path = pending;
      pending = null;
      setTimeout(() => h(path), 250);
    }
    return () => {
      if (handler === h) handler = null;
    };
  }, []);
}
