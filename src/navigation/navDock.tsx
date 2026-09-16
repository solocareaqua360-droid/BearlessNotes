import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';

// What the dock is showing instead of the desks.
//
// The dock (FloatingIslandTabBar) is the switch between the four desks.
// The user's own idea - «план навігації» in the project memory - is that
// it should change SHAPE with the context instead of the app growing a
// new control for every context: inside folders it becomes the path, in
// the calendar a date scrubber, and held down it always goes back to the
// dots that say which desk you are on, so context can never steal
// navigation.
//
// This is how a screen tells it. One publisher at a time - whichever
// screen is focused - and `null` means "nothing to say", which is when
// the dock is simply the dock.
export type DockStripItem = {
  key: string;
  label: string;
  // A second, smaller line - what tells the eye that this day belongs to
  // the month next door. Left out where the label speaks for itself.
  sub?: string;
};

// The shapes the dock can take. A new context adds a case here and a
// publisher on its own screen; nothing else in the app has to know.
export type DockContext =
  | {
      kind: 'path';
      // Folder names from the root down, the deepest last.
      crumbs: string[];
      // Where a crumb leads: '' is the root, which is also what puts the
      // desks back.
      onGo: (path: string) => void;
    }
  | {
      // A run of things you scrub through with your thumb - days, for
      // now. The SCREEN builds the labels, because it is the one that
      // knows what they mean; the dock only draws them and reports a tap.
      kind: 'strip';
      items: DockStripItem[];
      selected: string;
      onPick: (key: string) => void;
    };

type Value = { context: DockContext | null; publish: (context: DockContext | null) => void };

const NavDockContext = createContext<Value | null>(null);

export function NavDockProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<DockContext | null>(null);
  const publish = useCallback((next: DockContext | null) => {
    // Same context, same dock. A screen publishes from an effect that
    // runs on every render, and a fresh object each time would redraw the
    // dock with it.
    setContext((prev) => {
      if (prev === next) return prev;
      if (!prev || !next || prev.kind !== next.kind) return next;
      if (prev.kind === 'path' && next.kind === 'path') {
        const same =
          prev.crumbs.length === next.crumbs.length && prev.crumbs.every((c, i) => c === next.crumbs[i]);
        return same && prev.onGo === next.onGo ? prev : next;
      }
      if (prev.kind === 'strip' && next.kind === 'strip') {
        const same =
          prev.selected === next.selected &&
          prev.items.length === next.items.length &&
          prev.items[0]?.key === next.items[0]?.key &&
          prev.items[prev.items.length - 1]?.key === next.items[next.items.length - 1]?.key;
        return same && prev.onPick === next.onPick ? prev : next;
      }
      return next;
    });
  }, []);
  const value = useMemo(() => ({ context, publish }), [context, publish]);
  return <NavDockContext.Provider value={value}>{children}</NavDockContext.Provider>;
}

// What the dock reads. Null where nothing has been wrapped.
export function useNavDockContext(): DockContext | null {
  return useContext(NavDockContext)?.context ?? null;
}

// What a screen writes. Publishing null (or unmounting) hands the dock
// back to the desks.
export function useNavDockPublisher() {
  return useContext(NavDockContext)?.publish;
}
