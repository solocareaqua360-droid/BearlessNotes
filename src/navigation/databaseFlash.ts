import { useEffect, useState } from 'react';
import type { PaneTarget } from './paneTarget';

// "WHERE YOU JUST CAME FROM" (the laptop's): leaving a database in the main
// pane opens the databases panel and lights that database's row for a
// moment, so the eye finds its place again. A moment, not a state - it
// goes out by itself.
const FLASH_MS = 1400;

let flash: { target: PaneTarget; at: number } | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());

export function flashDatabase(target: PaneTarget): void {
  const mine = { target, at: Date.now() };
  flash = mine;
  tell();
  setTimeout(() => {
    if (flash !== mine) return;
    flash = null;
    tell();
  }, FLASH_MS);
}

export function useDatabaseFlash(): PaneTarget | null {
  const [value, setValue] = useState(flash?.target ?? null);
  useEffect(() => {
    const listener = () => setValue(flash?.target ?? null);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}
