import { useEffect } from 'react';

// "OPEN THIS ONE WHEN YOU GET THERE": a screen sends you to a database and
// asks it to open one of its items as it arrives - a photo in its viewer, a
// file in its preview, a link in its card (the folders' canvas, 2026-10-02:
// a tap on a tile landed on the database, not on the thing). One request
// at a time, taken by the first screen of that collection that has the
// item; it waits while the list is still loading.
let pending: { collection: string; id: string } | null = null;

export function requestOpen(collection: string, id: string) {
  pending = { collection, id };
}

export function useOpenRequest(collection: string, ids: string[], open: (id: string) => void) {
  useEffect(() => {
    if (!pending || pending.collection !== collection) return;
    const id = pending.id;
    if (!ids.includes(id)) return;
    pending = null;
    open(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, ids.join('|')]);
}
