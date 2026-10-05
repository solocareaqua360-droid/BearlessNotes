// The one door the app uses to reach Firestore.
//
// Every screen, hook and helper imports the database API from here rather
// than from a package, and that indirection is the whole point: the
// native app talks to @react-native-firebase, a browser cannot (it is a
// native module), and the browser build will get a sibling of this file
// pointing at the plain JavaScript SDK instead. Metro picks the sibling
// for the web target by itself.
//
// It costs nothing on the phone - a re-export is not a layer, it compiles
// to the same calls - and it is the difference between "swap one file"
// and "edit fifty".
//
// Both SDKs expose the SAME modular API, name for name: collection, doc,
// onSnapshot, query, where, writeBatch and the rest. That is what makes
// this possible at all, and it is why nothing here wraps or renames
// anything: the moment this file starts having opinions, the two sides
// can drift.
//
// ONE EXCEPTION (2026-10-05): onSnapshot SHARES. The diagnosis found 151
// live listeners where a few dozen were different - every note listened
// to nine times over, one settings document 44 times - because every hook
// instance (a tag picker in each desk, a tile colour in each card...)
// opened its own. Each native listener re-reads and re-sends its whole
// result on every change, so every autosave sent the whole documents
// collection across the bridge nine times, and the app slowed down the
// longer it ran, as screens piled up. Now identical subscriptions (same
// document, or same query and same options) ride ONE native listener and
// hear the same snapshots; it closes a few seconds after the last one
// leaves. Same signature and behaviour for every caller.
//
// Counted and timed for the diagnosis too (utils/perfWatch, temporary).
import { onSnapshot as rawOnSnapshot } from '@react-native-firebase/firestore';
import { listenerStarted, listenerStopped, snapshotHandled } from './utils/perfWatch';

export * from '@react-native-firebase/firestore';

type Callback = (value: unknown) => void;
type Subscriber = { next: Callback; error?: Callback };
type Shared = {
  label: string;
  subscribers: Set<Subscriber>;
  last?: unknown;
  stop: (() => void) | null;
  closeTimer?: ReturnType<typeof setTimeout>;
};

const shared = new Map<string, Shared>();
const LINGER_MS = 3000;

function labelOf(target: unknown): string {
  const t = target as { path?: string; _collectionPath?: { relativeName?: string } };
  try {
    if (typeof t.path === 'string') return `doc:${t.path.split('/')[0]}`;
    if (t._collectionPath?.relativeName) return t._collectionPath.relativeName;
  } catch {
    // An unknown shape is still a listener.
  }
  return '?';
}

// What makes two subscriptions the same one - or null, and it is not
// shared at all (anything this cannot read exactly is left alone).
function keyOf(target: unknown, options: unknown): string | null {
  try {
    const opts = JSON.stringify(options ?? {});
    const t = target as {
      path?: string;
      _converter?: unknown;
      _collectionPath?: { relativeName?: string };
      _modifiers?: { filters: unknown; orders: unknown; options: unknown; type: unknown };
    };
    if (t._converter) return null;
    if (typeof t.path === 'string' && !t._modifiers) return `d:${t.path}|${opts}`;
    if (t._collectionPath && t._modifiers) {
      const m = t._modifiers;
      return `q:${t._collectionPath.relativeName}|${String(m.type)}|${JSON.stringify(m.filters)}|${JSON.stringify(
        m.orders
      )}|${JSON.stringify(m.options)}|${opts}`;
    }
  } catch {
    return null;
  }
  return null;
}

export const onSnapshot = ((target: unknown, ...args: unknown[]) => {
  const label = labelOf(target);
  // The forms: (next, error?, complete?) or (options, next, error?, ...).
  // An observer object is passed through as it came.
  const hasOptions = typeof args[0] === 'object' && args[0] !== null && typeof (args[0] as { next?: unknown }).next !== 'function';
  const options = hasOptions ? args[0] : undefined;
  const rest = hasOptions ? args.slice(1) : args;
  const next = typeof rest[0] === 'function' ? (rest[0] as Callback) : null;
  const error = typeof rest[1] === 'function' ? (rest[1] as Callback) : undefined;
  const key = next ? keyOf(target, options) : null;

  if (!key || !next) {
    listenerStarted(label);
    const unsubscribe = (rawOnSnapshot as (...a: unknown[]) => () => void)(target, ...args);
    let stopped = false;
    return () => {
      if (!stopped) {
        stopped = true;
        listenerStopped(label);
      }
      unsubscribe();
    };
  }

  let entry = shared.get(key);
  if (!entry) {
    const created: Shared = { label, subscribers: new Set(), stop: null };
    entry = created;
    shared.set(key, created);
    listenerStarted(label);
    const fanOut = (value: unknown) => {
      created.last = value;
      const begin = Date.now();
      created.subscribers.forEach((s) => {
        try {
          s.next(value);
        } catch (e) {
          console.error(e);
        }
      });
      snapshotHandled(label, Date.now() - begin);
    };
    const fail = (e: unknown) => {
      // A listener that has failed is over: the next subscription opens a
      // fresh one rather than joining a dead one.
      if (shared.get(key) === created) shared.delete(key);
      listenerStopped(label);
      created.stop = null;
      created.subscribers.forEach((s) => s.error?.(e));
    };
    const native = (rawOnSnapshot as (...a: unknown[]) => () => void)(
      target,
      ...(hasOptions ? [options, fanOut, fail] : [fanOut, fail])
    );
    created.stop = native;
  } else {
    clearTimeout(entry.closeTimer);
  }

  const mine: Subscriber = { next, error };
  const joined = entry;
  joined.subscribers.add(mine);
  // A late joiner hears where things stand - asynchronously, as Firestore's
  // own first snapshot always arrives.
  if (joined.last !== undefined) {
    const last = joined.last;
    setTimeout(() => {
      if (joined.subscribers.has(mine) && joined.last === last) mine.next(last);
    }, 0);
  }

  return () => {
    if (!joined.subscribers.delete(mine)) return;
    if (joined.subscribers.size > 0) return;
    clearTimeout(joined.closeTimer);
    joined.closeTimer = setTimeout(() => {
      if (joined.subscribers.size > 0 || !joined.stop) return;
      joined.stop();
      joined.stop = null;
      if (shared.get(key) === joined) shared.delete(key);
      listenerStopped(label);
    }, LINGER_MS);
  };
}) as typeof rawOnSnapshot;
