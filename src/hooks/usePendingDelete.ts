import { useRef, useState } from 'react';

const UNDO_WINDOW_MS = 4000;

// The database-object screens (Links/Photos/Files) delete with a real undo,
// not a blocking "are you sure?" dialog (see PROJECT_BRIEF.md's "обов'язкова
// кнопка відміни" requirement) - pressing delete hides the item immediately
// and starts a timer; the actual Firestore delete only runs once that timer
// fires unopposed. Undo just cancels the timer, so nothing was ever touched.
// Only one item is "pending" at a time - starting a new delete commits
// whatever was already pending instead of silently dropping it.
export function usePendingDelete<T extends { id: string }>() {
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingRef = useRef<Record<string, { timeoutId: ReturnType<typeof setTimeout>; commit: () => void }>>({});
  const [toast, setToast] = useState<{ id: string; message: string } | null>(null);

  function filterPending(items: T[]): T[] {
    return items.filter((item) => !pendingIds.has(item.id));
  }

  function commitPending(id: string) {
    const entry = pendingRef.current[id];
    if (!entry) return;
    clearTimeout(entry.timeoutId);
    delete pendingRef.current[id];
    entry.commit();
  }

  function requestDelete(item: T, message: string, commit: () => void) {
    Object.keys(pendingRef.current).forEach(commitPending);
    setPendingIds((prev) => new Set(prev).add(item.id));
    setToast({ id: item.id, message });
    const timeoutId = setTimeout(() => {
      delete pendingRef.current[item.id];
      commit();
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      setToast((prev) => (prev?.id === item.id ? null : prev));
    }, UNDO_WINDOW_MS);
    pendingRef.current[item.id] = { timeoutId, commit };
  }

  function undo(id: string) {
    const entry = pendingRef.current[id];
    if (!entry) return;
    clearTimeout(entry.timeoutId);
    delete pendingRef.current[id];
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setToast((prev) => (prev?.id === id ? null : prev));
  }

  return { filterPending, requestDelete, undo, toast };
}
