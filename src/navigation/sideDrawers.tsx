import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SharedValue, useSharedValue } from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import { useDrawerCoverPublisher, useNavDrawerProgress } from './navDock';
import { listenCalendarRequests } from './calendarRequest';

// THE TWO SCREENS BESIDE THE DESKS - the user's iOS model (2026-09-28):
// the calendar left of the first desk, the databases right of the last,
// each laid over the blurred desk. This holds whether each is open, and
// lets a screen that needs the sideways swipe for itself (a board's
// canvas) keep the edges from opening anything while it is up.
type SideDrawers = {
  // 0 shut .. 1 open, on the UI thread: the swipe moves the layer WITH
  // the finger by writing this directly, instead of waiting for the
  // finger to lift and then playing an animation - which is what read as
  // "сповільнене".
  calendarProgress: SharedValue<number> | null;
  calendarOpen: boolean;
  // A day asked for from elsewhere (see calendarRequest) - counted, so the
  // same day asked for twice is still a second request.
  calendarJump: { key: string; n: number } | null;
  // A swipe is carrying the layer in or out right now - its blur is
  // needed before the layer counts as open.
  calendarDragging: boolean;
  setCalendarDragging: (dragging: boolean) => void;
  openCalendar: () => void;
  closeCalendar: () => void;
  databasesProgress: SharedValue<number> | null;
  databasesOpen: boolean;
  databasesDragging: boolean;
  setDatabasesDragging: (dragging: boolean) => void;
  openDatabases: () => void;
  closeDatabases: () => void;
  // How many screens are holding the swipe back right now.
  swipeBlocked: boolean;
  blockSwipe: () => () => void;
  // A screen with a sideways scroll of its own (a table, a kanban) holds
  // this: the swipe to the calendar / databases then starts only from the
  // screen's EDGE, where the scroll is not, instead of anywhere.
  swipeEdgeOnly: boolean;
  holdEdgeOnly: () => () => void;
};

const NONE: SideDrawers = {
  calendarProgress: null,
  calendarOpen: false,
  calendarJump: null,
  calendarDragging: false,
  setCalendarDragging: () => {},
  openCalendar: () => {},
  closeCalendar: () => {},
  databasesProgress: null,
  databasesOpen: false,
  databasesDragging: false,
  setDatabasesDragging: () => {},
  openDatabases: () => {},
  closeDatabases: () => {},
  swipeBlocked: true,
  blockSwipe: () => () => {},
  swipeEdgeOnly: false,
  holdEdgeOnly: () => () => {},
};

// Exported so the layers - drawn through the glass portal, outside this
// tree - can be handed it again.
export const SideDrawersContext = createContext<SideDrawers | null>(null);

export function SideDrawersProvider({ children }: { children: ReactNode }) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarDragging, setCalendarDragging] = useState(false);
  const [databasesOpen, setDatabasesOpen] = useState(false);
  const [databasesDragging, setDatabasesDragging] = useState(false);
  const [blocks, setBlocks] = useState(0);
  const [calendarJump, setCalendarJump] = useState<{ key: string; n: number } | null>(null);
  useEffect(
    () =>
      listenCalendarRequests((key) => {
        setCalendarJump((prev) => ({ key, n: (prev?.n ?? 0) + 1 }));
        setDatabasesOpen(false);
        setCalendarOpen(true);
      }),
    []
  );
  // The dock's own copies when there is a dock (there always is): the bar
  // and the dock fade by the same numbers the layers slide by.
  const fallbackLeft = useSharedValue(0);
  const fallbackRight = useSharedValue(0);
  const dockProgress = useNavDrawerProgress();
  const calendarProgress = dockProgress?.left ?? fallbackLeft;
  const databasesProgress = dockProgress?.right ?? fallbackRight;
  // Told to the dock: whether the desks are the screen in front (a note
  // opened from a layer is pushed OVER them, and must keep its own bar
  // and dock), and whether a layer is out.
  const tabsFocused = useIsFocused();
  const publishCover = useDrawerCoverPublisher();
  const anyOpen = calendarOpen || databasesOpen;
  useEffect(() => {
    publishCover?.({ active: tabsFocused, open: anyOpen });
  }, [publishCover, tabsFocused, anyOpen]);
  useEffect(() => () => publishCover?.({ active: false, open: false }), [publishCover]);
  // One at a time: opening one side shuts the other.
  const openCalendar = useCallback(() => {
    setDatabasesOpen(false);
    setCalendarOpen(true);
  }, []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);
  const openDatabases = useCallback(() => {
    setCalendarOpen(false);
    setDatabasesOpen(true);
  }, []);
  const closeDatabases = useCallback(() => setDatabasesOpen(false), []);
  const blockSwipe = useCallback(() => {
    setBlocks((n) => n + 1);
    return () => setBlocks((n) => n - 1);
  }, []);
  const [edgeOnly, setEdgeOnly] = useState(0);
  const holdEdgeOnly = useCallback(() => {
    setEdgeOnly((n) => n + 1);
    return () => setEdgeOnly((n) => n - 1);
  }, []);
  const value = useMemo(
    () => ({
      calendarProgress,
      calendarOpen,
      calendarJump,
      calendarDragging,
      setCalendarDragging,
      openCalendar,
      closeCalendar,
      databasesProgress,
      databasesOpen,
      databasesDragging,
      setDatabasesDragging,
      openDatabases,
      closeDatabases,
      swipeBlocked: blocks > 0,
      blockSwipe,
      swipeEdgeOnly: edgeOnly > 0,
      holdEdgeOnly,
    }),
    [
      calendarProgress,
      calendarOpen,
      calendarJump,
      calendarDragging,
      openCalendar,
      closeCalendar,
      databasesProgress,
      databasesOpen,
      databasesDragging,
      openDatabases,
      closeDatabases,
      blocks,
      blockSwipe,
      edgeOnly,
      holdEdgeOnly,
    ]
  );
  return <SideDrawersContext.Provider value={value}>{children}</SideDrawersContext.Provider>;
}

// Outside the provider (the browser's tabs, a pushed screen) there are no
// layers: everything reads closed and blocked.
export function useSideDrawers(): SideDrawers {
  return useContext(SideDrawersContext) ?? NONE;
}

// Held by a screen that scrolls sideways itself: the swipe past the desks
// then begins at the edge of the screen only (see Tabs).
export function useEdgeOnlyDrawerSwipe(active: boolean) {
  const { holdEdgeOnly } = useSideDrawers();
  useEffect(() => (active ? holdEdgeOnly() : undefined), [active, holdEdgeOnly]);
}

// Held by a screen whose own sideways drags would be taken by the swipe.
export function useBlockDrawerSwipe(active: boolean) {
  const { blockSwipe } = useSideDrawers();
  useEffect(() => (active ? blockSwipe() : undefined), [active, blockSwipe]);
}

// Given to the calendar drawn INSIDE its layer, so it knows it is there:
// it draws its own bar and dock, and its way back closes the layer rather
// than stepping to another desk.
export const CalendarDrawerContext = createContext<{
  open: boolean;
  close: () => void;
  jump: { key: string; n: number } | null;
} | null>(null);

// The same, for the databases («Більше») drawn inside theirs.
export const DatabasesLayerContext = createContext<{ open: boolean; close: () => void } | null>(null);
