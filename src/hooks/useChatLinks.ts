import { useEffect, useState } from 'react';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';

// WHAT A CHAT MESSAGE POINTS AT, live (the user, 2026-10-12): a message that made a task is
// STRUCK THROUGH once the task is closed (it is no longer news), and a picture that was cleaned
// away says so in small grey words instead of a broken frame. One shared listener per
// collection for the whole chat, however many messages there are.
type Store<V> = { value: V; loaded: boolean; listeners: Set<() => void>; stop: (() => void) | null };

function makeStore<V>(init: V, collection: string, read: (docs: { id: string; data: () => Record<string, unknown> }[]) => V): Store<V> & { use: () => { value: V; loaded: boolean } } {
  const store: Store<V> = { value: init, loaded: false, listeners: new Set(), stop: null };
  const use = () => {
    const [, tick] = useState(0);
    useEffect(() => {
      const l = () => tick((t) => t + 1);
      store.listeners.add(l);
      if (!store.stop) {
        store.stop = onSnapshot(
          ownedQuery(collection),
          (snap) => {
            store.value = read(snap.docs as never);
            store.loaded = true;
            store.listeners.forEach((x) => x());
          },
          listenError(`useChatLinks:${collection}`)
        );
      }
      return () => {
        store.listeners.delete(l);
        if (store.listeners.size === 0 && store.stop) {
          store.stop();
          store.stop = null;
        }
      };
    }, []);
    return { value: store.value, loaded: store.loaded };
  };
  return Object.assign(store, { use });
}

// task id -> closed?
const tasks = makeStore<Map<string, boolean>>(new Map(), 'tasks', (docs) => {
  const m = new Map<string, boolean>();
  docs.forEach((d) => {
    const data = d.data();
    if (!data.deletedAt) m.set(d.id, !!data.checked);
  });
  return m;
});
// photos that still exist and are not in the bin
const photos = makeStore<Set<string>>(new Set(), 'photos', (docs) => {
  const s = new Set<string>();
  docs.forEach((d) => {
    if (!d.data().deletedAt) s.add(d.id);
  });
  return s;
});

export const useTaskClosedMap = () => tasks.use();
export const usePhotosAlive = () => photos.use();
