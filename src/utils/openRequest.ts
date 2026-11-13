import { useEffect, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';

// "OPEN THIS ONE WHEN YOU GET THERE": a screen sends you to a database and
// asks it to open one of its items as it arrives - a photo in its viewer, a
// file in its preview, a link in its card (the folders' canvas, 2026-10-02:
// a tap on a tile landed on the database, not on the thing). One request
// at a time, taken by the first screen of that collection that has the
// item; it waits while the list is still loading.
let pending: { collection: string; id: string; back: boolean } | null = null;

// `back`: asked from a place that is NOT a database (the single explorer): when
// the thing is closed, the way back is taken for you - otherwise closing a card
// left you standing in the database, one more step from where you were.
export function requestOpen(collection: string, id: string, options: { back?: boolean } = {}) {
  pending = { collection, id, back: !!options.back };
}

// `isOpen`: whether this screen is showing the thing right now - given, the
// screen can take the way back for a request made with `back` (see above).
export function useOpenRequest(
  collection: string,
  ids: string[],
  open: (id: string, back: boolean) => void,
  isOpen?: boolean
) {
  const navigation = useNavigation();
  const armed = useRef(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!pending || pending.collection !== collection) return;
    const { id, back } = pending;
    if (!ids.includes(id)) return;
    pending = null;
    armed.current = back && isOpen !== undefined;
    open(id, back);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, ids.join('|')]);
  useEffect(() => {
    if (isOpen === undefined) return;
    if (wasOpen.current && !isOpen && armed.current) {
      armed.current = false;
      if (navigation.canGoBack()) navigation.goBack();
    }
    wasOpen.current = isOpen;
  }, [isOpen]);
}
