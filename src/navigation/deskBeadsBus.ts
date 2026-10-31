import { useEffect, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';

// THE THREE DESKS, FOR THE BOTTOM DOCK (2026-10-12, the desk dock): the tab bar (FloatingIslandTabBar) owns the
// desks and registers them here while they are in front; the dock, which lives at the root and knows nothing of
// tabs, reads them and draws the three round buttons. The same shape as deskSwitcherBus.
export type DeskBead = {
  key: string;
  label: string;
  icon: string;
  active: boolean;
  // A tool's orange dot (see DockAction.dot).
  dot?: boolean;
  onPress: () => void;
};

let current: DeskBead[] | null = null;
// How many desks are open BEYOND the three fixed ones (the dock shows them as dots on the multitasking circle).
let extra = 0;
const listeners = new Set<() => void>();

export function registerDeskBeads(beads: DeskBead[] | null, extraDesks = 0) {
  current = beads;
  extra = beads ? extraDesks : 0;
  listeners.forEach((l) => l());
}

export function useExtraDeskCount(): number {
  const [n, setN] = useState(extra);
  useEffect(() => {
    const listener = () => setN(extra);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return n;
}

export function useDeskBeads(): DeskBead[] | null {
  const [beads, setBeads] = useState<DeskBead[] | null>(current);
  useEffect(() => {
    const listener = () => setBeads(current);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return beads;
}

// THE DESKS INSIDE A BASE TOO (2026-10-16, the user's: «док, щоб можна було дотягнутися в будь-якому місці», every
// base - personal or built-in - but not a single card, board or note, which keep their own dock). The tab bar
// registers the three fixed desks a second time here, as a way to REACH them from a screen pushed over the tabs (its
// buttons go to the tab through the root navigator), and a base claims them while it is in front.
let reach: DeskBead[] | null = null;
const reachListeners = new Set<() => void>();
export function registerDeskReach(beads: DeskBead[] | null) {
  reach = beads;
  reachListeners.forEach((l) => l());
}
export function useDeskReach(): DeskBead[] | null {
  const [beads, setBeads] = useState<DeskBead[] | null>(reach);
  useEffect(() => {
    const listener = () => setBeads(reach);
    reachListeners.add(listener);
    listener();
    return () => {
      reachListeners.delete(listener);
    };
  }, []);
  return beads;
}

let desksHereClaims = 0;
const desksHereListeners = new Set<() => void>();
// A base says it wants the desks in its dock while `on` (it is focused).
export function useDockDesksHere(on: boolean) {
  useEffect(() => {
    if (!on) return;
    desksHereClaims += 1;
    desksHereListeners.forEach((l) => l());
    return () => {
      desksHereClaims -= 1;
      desksHereListeners.forEach((l) => l());
    };
  }, [on]);
}
// The same, for as long as the screen calling it is the focused one.
export function useDockDesksWhileFocused(enabled = true) {
  useDockDesksHere(useIsFocused() && enabled);
}
export function useDockDesksWanted(): boolean {
  const [on, setOn] = useState(desksHereClaims > 0);
  useEffect(() => {
    const listener = () => setOn(desksHereClaims > 0);
    desksHereListeners.add(listener);
    listener();
    return () => {
      desksHereListeners.delete(listener);
    };
  }, []);
  return on;
}

// WHETHER THE DOCK CARRIES THE WAY BACK (2026-10-13, the user's: the top-left back button «не несе додаткового
// функціоналу» when the circle at the dock's right end is back): DeskDock says so while it is on screen, and the
// bar then draws no back button of its own and keeps the same room empty so the name stays on the screen's middle.
// Dropped only after a short hold, so a dock that is replaced a moment later does not make the button blink.
let carries = false;
let carriesTimer: ReturnType<typeof setTimeout> | null = null;
const carriesListeners = new Set<() => void>();

// Counted, not a flag: several holders can say so at once (the dock's circle, and the note's search, which keeps the bar steady
// while the dock is away) - one letting go must not take it from the others.
let carriesHolders = 0;
export function setDockCarriesBack(on: boolean) {
  carriesHolders = Math.max(0, carriesHolders + (on ? 1 : -1));
  const next = carriesHolders > 0;
  if (carriesTimer) {
    clearTimeout(carriesTimer);
    carriesTimer = null;
  }
  const apply = () => {
    if (carries === next) return;
    carries = next;
    carriesListeners.forEach((l) => l());
  };
  if (next) apply();
  else carriesTimer = setTimeout(apply, 350);
}

export function useDockCarriesBack(): boolean {
  const [on, setOn] = useState(carries);
  useEffect(() => {
    const listener = () => setOn(carries);
    carriesListeners.add(listener);
    listener();
    return () => {
      carriesListeners.delete(listener);
    };
  }, []);
  return on;
}
