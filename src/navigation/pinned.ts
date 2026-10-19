import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { setDoc } from '../utils/owned';
import { listenError } from '../utils/listenError';

// «ЗАКРІПЛЕНІ» (the Mac's frame B, 2026-10-19, after Claude's sidebar): a few things kept at hand in the sidebar -
// a note, one of the user's bases, a folder. Kept in the account's settings, the same place the desks live.
export type Pin = { kind: 'note'; id: string } | { kind: 'custom'; id: string } | { kind: 'folder'; path: string };

const pinnedDoc = doc(db, 'settings', 'pinned');
export const pinKey = (p: Pin) => (p.kind === 'folder' ? `folder:${p.path}` : `${p.kind}:${p.id}`);

// One listener for every reader (the sidebar, the note's menu, a base's menu).
let current: Pin[] = [];
const listeners = new Set<(pins: Pin[]) => void>();
let stop: (() => void) | null = null;
function listen() {
  if (stop) return;
  stop = onSnapshot(
    pinnedDoc,
    (snapshot) => {
      const stored = snapshot.data()?.items as Pin[] | undefined;
      current = Array.isArray(stored) ? stored : [];
      listeners.forEach((l) => l(current));
    },
    listenError('pinned')
  );
}

export function usePins(): { pins: Pin[]; isPinned: (p: Pin) => boolean; toggle: (p: Pin) => void } {
  const [pins, setPins] = useState<Pin[]>(current);
  useEffect(() => {
    listeners.add(setPins);
    listen();
    setPins(current);
    return () => {
      listeners.delete(setPins);
    };
  }, []);
  const isPinned = useCallback((p: Pin) => pins.some((x) => pinKey(x) === pinKey(p)), [pins]);
  const toggle = useCallback(
    (p: Pin) => {
      const key = pinKey(p);
      const next = current.some((x) => pinKey(x) === key) ? current.filter((x) => pinKey(x) !== key) : [...current, p];
      current = next;
      listeners.forEach((l) => l(next));
      setDoc(pinnedDoc, { items: next }, { merge: true }).catch(() => {});
    },
    []
  );
  return { pins, isPinned, toggle };
}
