import { useRef, useState } from 'react';

const UNDO_WINDOW_MS = 4000;

type PendingEntry = { ids: string[]; timeoutId: ReturnType<typeof setTimeout>; commit: () => void };

// The database-object screens (Links/Photos/Files) delete with a real undo,
// not a blocking "are you sure?" dialog (see PROJECT_BRIEF.md's "обов'язкова
// кнопка відміни" requirement) - pressing delete hides the item immediately
// and starts a timer; the actual Firestore delete only runs once that timer
// fires unopposed. Undo just cancels the timer, so nothing was ever touched.
// Only one delete (single or bulk) is "pending" at a time - starting a new
// one commits whatever was already pending instead of silently dropping it.
export function usePendingDelete<T extends { id: string }>() {
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingRef = useRef<Record<string, PendingEntry>>({});
  const [toast, setToast] = useState<{ id: string; message: string } | null>(null);

  function filterPending(items: T[]): T[] {
    return items.filter((item) => !pendingIds.has(item.id));
  }

  function commitEntry(key: string) {
    const entry = pendingRef.current[key];
    if (!entry) return;
    clearTimeout(entry.timeoutId);
    delete pendingRef.current[key];
    entry.commit();
  }

  function commitAllPending() {
    Object.keys(pendingRef.current).forEach(commitEntry);
  }

  function startPending(key: string, ids: string[], message: string, commit: () => void) {
    commitAllPending();
    setPendingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    setToast({ id: key, message });
    const timeoutId = setTimeout(() => {
      delete pendingRef.current[key];
      commit();
      setPendingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setToast((prev) => (prev?.id === key ? null : prev));
    }, UNDO_WINDOW_MS);
    pendingRef.current[key] = { ids, timeoutId, commit };
  }

  function requestDelete(item: T, message: string, commit: () => void) {
    startPending(item.id, [item.id], message, commit);
  }

  // Same idea as requestDelete, for N items under one undo window - deleting
  // them one at a time would mean N separate toasts racing each other.
  function requestDeleteMany(items: T[], message: string, commit: () => void) {
    startPending(`batch-${Date.now()}`, items.map((item) => item.id), message, commit);
  }

  function undo(key: string) {
    const entry = pendingRef.current[key];
    if (!entry) return;
    clearTimeout(entry.timeoutId);
    delete pendingRef.current[key];
    setPendingIds((prev) => {
      const next = new Set(prev);
      entry.ids.forEach((id) => next.delete(id));
      return next;
    });
    setToast((prev) => (prev?.id === key ? null : prev));
  }

  return { filterPending, requestDelete, requestDeleteMany, undo, toast };
}
