import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// THE TWO DRAWERS OVER THE DESKS - the user's new layout (2026-09-28):
// the calendar slides in from the left, the databases (next stage) from
// the right, and the middle is the desks. This holds whether each is
// open, and lets a screen that needs the sideways swipe for itself (a
// board's canvas) keep the edges from opening anything while it is up.
type SideDrawers = {
  calendarOpen: boolean;
  openCalendar: () => void;
  closeCalendar: () => void;
  // How many screens are holding the swipe back right now.
  swipeBlocked: boolean;
  blockSwipe: () => () => void;
};

const NONE: SideDrawers = {
  calendarOpen: false,
  openCalendar: () => {},
  closeCalendar: () => {},
  swipeBlocked: true,
  blockSwipe: () => () => {},
};

const SideDrawersContext = createContext<SideDrawers | null>(null);

export function SideDrawersProvider({ children }: { children: ReactNode }) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [blocks, setBlocks] = useState(0);
  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);
  const blockSwipe = useCallback(() => {
    setBlocks((n) => n + 1);
    return () => setBlocks((n) => n - 1);
  }, []);
  const value = useMemo(
    () => ({ calendarOpen, openCalendar, closeCalendar, swipeBlocked: blocks > 0, blockSwipe }),
    [calendarOpen, openCalendar, closeCalendar, blocks, blockSwipe]
  );
  return <SideDrawersContext.Provider value={value}>{children}</SideDrawersContext.Provider>;
}

// Outside the provider (the browser's tabs, a pushed screen) there are no
// drawers: everything reads closed and blocked.
export function useSideDrawers(): SideDrawers {
  return useContext(SideDrawersContext) ?? NONE;
}

// Held by a screen whose own sideways drags would be taken by the swipe.
export function useBlockDrawerSwipe(active: boolean) {
  const { blockSwipe } = useSideDrawers();
  useEffect(() => (active ? blockSwipe() : undefined), [active, blockSwipe]);
}

// Given to the calendar drawn INSIDE the drawer, so it knows it is there:
// it publishes to the bar and the dock only while the drawer is open, and
// its way back closes the drawer rather than stepping to another desk.
export const CalendarDrawerContext = createContext<{ open: boolean; close: () => void } | null>(null);
