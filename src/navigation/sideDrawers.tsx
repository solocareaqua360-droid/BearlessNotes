import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SharedValue, useSharedValue } from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import { useDrawerCoverPublisher, useNavDrawerProgress } from './navDock';

// THE TWO DRAWERS OVER THE DESKS - the user's new layout (2026-09-28):
// the calendar slides in from the left, the databases (next stage) from
// the right, and the middle is the desks. This holds whether each is
// open, and lets a screen that needs the sideways swipe for itself (a
// board's canvas) keep the edges from opening anything while it is up.
type SideDrawers = {
  // 0 shut .. 1 open, on the UI thread: the swipe moves the drawer WITH
  // the finger by writing this directly, instead of waiting for the
  // finger to lift and then playing an animation - which is what read as
  // "сповільнене".
  calendarProgress: SharedValue<number> | null;
  calendarOpen: boolean;
  // A swipe is carrying the calendar in or out right now - its blur is
  // needed before the drawer counts as open.
  calendarDragging: boolean;
  setCalendarDragging: (dragging: boolean) => void;
  openCalendar: () => void;
  closeCalendar: () => void;
  // How many screens are holding the swipe back right now.
  swipeBlocked: boolean;
  blockSwipe: () => () => void;
};

const NONE: SideDrawers = {
  calendarProgress: null,
  calendarOpen: false,
  calendarDragging: false,
  setCalendarDragging: () => {},
  openCalendar: () => {},
  closeCalendar: () => {},
  swipeBlocked: true,
  blockSwipe: () => () => {},
};

// Exported so the calendar's layer - drawn through the glass portal,
// outside this tree - can be handed it again.
export const SideDrawersContext = createContext<SideDrawers | null>(null);

export function SideDrawersProvider({ children }: { children: ReactNode }) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarDragging, setCalendarDragging] = useState(false);
  const [blocks, setBlocks] = useState(0);
  // The dock's own copy when there is a dock (there always is): the bar
  // and the dock fade by the same number the drawer slides by.
  const fallbackProgress = useSharedValue(0);
  const calendarProgress = useNavDrawerProgress() ?? fallbackProgress;
  // Told to the dock: whether the desks are the screen in front (a note
  // opened from the calendar is pushed OVER them, and must keep its own
  // bar and dock), and whether the drawer is out.
  const tabsFocused = useIsFocused();
  const publishCover = useDrawerCoverPublisher();
  useEffect(() => {
    publishCover?.({ active: tabsFocused, open: calendarOpen });
  }, [publishCover, tabsFocused, calendarOpen]);
  useEffect(() => () => publishCover?.({ active: false, open: false }), [publishCover]);
  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);
  const blockSwipe = useCallback(() => {
    setBlocks((n) => n + 1);
    return () => setBlocks((n) => n - 1);
  }, []);
  const value = useMemo(
    () => ({
      calendarProgress,
      calendarOpen,
      calendarDragging,
      setCalendarDragging,
      openCalendar,
      closeCalendar,
      swipeBlocked: blocks > 0,
      blockSwipe,
    }),
    [calendarProgress, calendarOpen, calendarDragging, openCalendar, closeCalendar, blocks, blockSwipe]
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
