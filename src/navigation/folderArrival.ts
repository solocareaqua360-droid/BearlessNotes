import { useContext, useEffect, useState } from 'react';
import { DeskContext } from './desks';

// "OPEN IT IN THIS FOLDER": the start desk's «Робочі столи» list a
// database's root folders, and a tap on one sends you to that database
// standing in it (2026-10-04). The same shape as openRequest: one request
// at a time, taken by the database screen of that kind - the one on its
// desk when the request says desk, a pushed one when it says screen (a
// database that is a desk is mounted all the time, and would otherwise
// take a request meant for a copy being pushed). The screen turns its
// explorer on first when it was off.
type Where = 'desk' | 'screen';
let pending: { kind: string; path: string; where: Where } | null = null;
const listeners = new Set<() => void>();

export function requestFolder(kind: string, path: string, where: Where) {
  pending = { kind, path, where };
  listeners.forEach((l) => l());
}

export function useFolderArrival(
  kind: string,
  explorerMode: boolean,
  setListMode: (mode: 'explorer') => void,
  setPath: (path: string) => void
) {
  const desk = useContext(DeskContext);
  const where: Where = desk ? 'desk' : 'screen';
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    if (!pending || pending.kind !== kind || pending.where !== where) return;
    if (!explorerMode) {
      // Back here once the mode has landed (explorerMode changes).
      setListMode('explorer');
      return;
    }
    const path = pending.path;
    pending = null;
    // After whatever the mode switch itself does to the path.
    setTimeout(() => setPath(path), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, explorerMode, kind, where]);
}
