import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { View } from 'react-native';

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
// A small mark under a day - what it means is the screen's business, not
// the dock's. 'ink' takes the dock's own ink, 'accent' its accent.
export type DockMark = 'ink' | 'accent';

export type DockStripItem = {
  key: string;
  label: string;
  // A second, smaller line under the label - the weekday, in the
  // calendar. It is not a footnote: the user navigates by it.
  sub?: string;
  // The one item the strip is ORIENTED by, which is NOT the selected one.
  // The selected item is already in the middle, so its position says so;
  // what the middle cannot say is where you were before you scrolled
  // away. In the calendar this is today - the user's own reasoning: "я
  // хочу знати, який справді день, а не до якого я домотав".
  anchor?: boolean;
  marks?: DockMark[];
};

// The shapes the dock can take. A new context adds a case here and a
// publisher on its own screen; nothing else in the app has to know.
export type DockContext =
  | {
      kind: 'path';
      // What this database IS - drawn in the bead that leads out of the
      // context, so the way out says where it goes.
      icon: string;
      // Folder names from the root down, the deepest last.
      crumbs: string[];
      // Where a crumb leads: '' is the root, which is also what puts the
      // desks back.
      onGo: (path: string) => void;
    }
  | {
      icon: string;
      // A run of things you scrub through with your thumb - days, for
      // now. The SCREEN builds the labels, because it is the one that
      // knows what they mean; the dock only draws them and reports a tap.
      kind: 'strip';
      items: DockStripItem[];
      selected: string;
      onPick: (key: string) => void;
    };

// How the dock's own crumbs become DROP TARGETS for a card being
// carried. It is a second, independent slot rather than part of the
// context: the screen publishes where it is (useExplorer) and the carry
// publishes how to register a target (useExplorerCarry), and those are
// two different hooks that learn their answers at different moments.
export type DockTargets = (path: string) => (node: View | null) => void;

type Value = {
  context: DockContext | null;
  publish: (context: DockContext | null) => void;
  // Stepped out of, without being given up: the context is still there,
  // one press brings it back. Lives here rather than in the dock because
  // the dock is drawn in more than one place now.
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  targets: DockTargets | null;
  publishTargets: (targets: DockTargets | null) => void;
};

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
        // By IDENTITY, not by comparing keys: the items carry marks that
        // arrive later than the days do (a dot query answering), and a
        // comparison that only looked at the first and last key would
        // call the strip unchanged and quietly keep the dotless version.
        // The publisher memoises, so identity is the honest test.
        const same =
          prev.items === next.items && prev.selected === next.selected && prev.onPick === next.onPick;
        return same ? prev : next;
      }
      return next;
    });
  }, []);
  // Held inside a box, not as the state itself: DockTargets IS a
  // function, and useState cannot tell a function it is meant to STORE
  // from a function it is meant to CALL as an updater.
  const [targetBox, setTargetBox] = useState<{ fn: DockTargets | null }>({ fn: null });
  const targets = targetBox.fn;
  // The same value never becomes a new render: this provider sits above
  // the entire app, so a needless setState here costs a pass over
  // everything - and a publisher handing over a fresh function each time
  // would loop, which is exactly what happened.
  const publishTargets = useCallback(
    (next: DockTargets | null) => setTargetBox((prev) => (prev.fn === next ? prev : { fn: next })),
    []
  );
  const [hidden, setHidden] = useState(false);
  // A new context is a new question, so a context stepped out of does not
  // stay stepped out of once you have gone somewhere else.
  const contextKey = context ? `${context.kind}:${context.icon}` : '';
  useEffect(() => setHidden(false), [contextKey]);
  const value = useMemo(
    () => ({ context, publish, targets, publishTargets, hidden, setHidden }),
    [context, publish, targets, publishTargets, hidden]
  );
  return <NavDockContext.Provider value={value}>{children}</NavDockContext.Provider>;
}

// What the dock reads. Null where nothing has been wrapped.
export function useNavDockContext(): DockContext | null {
  const value = useContext(NavDockContext);
  if (!value || value.hidden) return null;
  return value.context;
}

// Whether there IS a context, hidden or not - what the desks ask before
// deciding to stand aside.
export function useNavDockHasContext(): boolean {
  return !!useContext(NavDockContext)?.context;
}

export function useNavDockHidden(): [boolean, (hidden: boolean) => void] {
  const value = useContext(NavDockContext);
  return [value?.hidden ?? false, value?.setHidden ?? (() => {})];
}

// What a screen writes. Publishing null (or unmounting) hands the dock
// back to the desks.
export function useNavDockPublisher() {
  return useContext(NavDockContext)?.publish;
}

// What the dock's crumbs register themselves with, and what a carry
// publishes into. Null where nothing is being carried anywhere.
export function useNavDockTargets(): DockTargets | null {
  return useContext(NavDockContext)?.targets ?? null;
}

export function useNavDockTargetPublisher() {
  return useContext(NavDockContext)?.publishTargets;
}
