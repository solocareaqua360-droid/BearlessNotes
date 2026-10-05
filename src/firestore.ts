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
// ONE EXCEPTION, TEMPORARY (2026-10-05): onSnapshot is counted and timed
// (utils/perfWatch) to find what slows the phone down over a session.
// Same signature, same behaviour; remove once that is answered.
import { onSnapshot as rawOnSnapshot } from '@react-native-firebase/firestore';
import { listenerStarted, listenerStopped, snapshotHandled } from './utils/perfWatch';

export * from '@react-native-firebase/firestore';

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

export const onSnapshot = ((target: unknown, ...args: unknown[]) => {
  const label = labelOf(target);
  const timed = args.map((arg, i) => {
    // The first function is the one that receives the snapshots.
    if (typeof arg !== 'function' || args.findIndex((a) => typeof a === 'function') !== i) return arg;
    return (...cbArgs: unknown[]) => {
      const start = Date.now();
      try {
        return (arg as (...a: unknown[]) => unknown)(...cbArgs);
      } finally {
        snapshotHandled(label, Date.now() - start);
      }
    };
  });
  listenerStarted(label);
  const unsubscribe = (rawOnSnapshot as (...a: unknown[]) => () => void)(target, ...timed);
  let stopped = false;
  return () => {
    if (!stopped) {
      stopped = true;
      listenerStopped(label);
    }
    unsubscribe();
  };
}) as typeof rawOnSnapshot;
