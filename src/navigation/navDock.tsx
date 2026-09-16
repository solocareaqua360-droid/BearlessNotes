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
export type DockTrail = {
  // Folder names from the root down, the deepest last.
  crumbs: string[];
  // Where a crumb leads: '' is the root, which is also what puts the
  // desks back.
  onGo: (path: string) => void;
};

type Value = { trail: DockTrail | null; publish: (trail: DockTrail | null) => void };

const NavDockContext = createContext<Value | null>(null);

export function NavDockProvider({ children }: { children: ReactNode }) {
  const [trail, setTrail] = useState<DockTrail | null>(null);
  const publish = useCallback((next: DockTrail | null) => {
    // Same path, same dock. A screen publishes from an effect that runs
    // on every render, and a fresh object each time would redraw the
    // dock with it.
    setTrail((prev) => {
      if (prev === next) return prev;
      if (!prev || !next) return next;
      const same =
        prev.crumbs.length === next.crumbs.length && prev.crumbs.every((c, i) => c === next.crumbs[i]);
      return same && prev.onGo === next.onGo ? prev : next;
    });
  }, []);
  const value = useMemo(() => ({ trail, publish }), [trail, publish]);
  return <NavDockContext.Provider value={value}>{children}</NavDockContext.Provider>;
}

// What the dock reads. Null where nothing has been wrapped.
export function useNavDockTrail(): DockTrail | null {
  return useContext(NavDockContext)?.trail ?? null;
}

// What a screen writes. Publishing null (or unmounting) hands the dock
// back to the desks.
export function useNavDockPublisher() {
  return useContext(NavDockContext)?.publish;
}
