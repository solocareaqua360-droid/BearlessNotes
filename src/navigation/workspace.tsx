import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { sameTarget, type PaneTarget } from './paneTarget';

// THE LAPTOP'S WORKSPACE (Mac stage 6): the main pane in the middle, and
// side panels on the right - the databases list, the chat, any database or
// screen a PaneTarget names. The arrangement is Claude Code's own window:
//
//   the first panel  - a column the whole height of the window, next to the
//                      main pane;
//   the second       - a second column of full height beside it;
//   the third        - splits the column NEAREST the main pane in two;
//   the fourth       - splits the far one; and so on, taking turns.
//
// There is no cap: a phone stops at a few open things because its screen
// does, a laptop has no such reason - a column scrolls when its panels no
// longer fit, and any panel folds to its header.
//
// The main pane is the navigator, unchanged. These panels stand BESIDE it,
// the way the rail does, and each one is a whole screen with its own dock
// publications and its own frame size (see PaneScreen).
export type PanelKind = 'databases' | 'chat' | 'target';

export type Panel = {
  id: string;
  kind: PanelKind;
  target?: PaneTarget;
  // Which column it stands in: 0 is the one nearest the main pane.
  column: 0 | 1;
  // Folded to its header, the column keeping its place.
  folded?: boolean;
  // Where a click inside the panel has taken it: what it shows now is the
  // last of these, and going back pops one - the panel is a small navigator
  // of its own, as a phone's screen is. Empty: the panel's own screen.
  stack?: PaneTarget[];
  // How much of its column's height it takes next to the panels beside it
  // (a share, 1 by default) - what a drag on the line between two panels sets.
  weight?: number;
};

export const COLUMN_MIN = 260;
export const COLUMN_MAX = 640;
export const COLUMN_DEFAULT = 380;

export type OpenSpec = { kind: PanelKind; target?: PaneTarget };

type Workspace = {
  panels: Panel[];
  // The whole side area put away (its panels keep their place).
  hidden: boolean;
  // Each column's own width - the near one and the far one.
  widths: [number, number];
  setWidth: (column: 0 | 1, width: number) => void;
  // Opens a panel - or, if one like it is already there, shows it.
  open: (spec: OpenSpec) => void;
  // Opens it, or shows it back at its own screen (what a click inside it
  // had taken it to is let go).
  openAtRoot: (spec: OpenSpec) => void;
  // Always a NEW panel, even if the same thing is already open elsewhere
  // (a second look at a database, with another filter).
  openAnother: (spec: OpenSpec) => void;
  close: (id: string) => void;
  // A click inside a panel that goes somewhere: on in the same panel...
  pushInPanel: (id: string, target: PaneTarget) => void;
  // ...and back out of it. False when there was nothing to go back to.
  popInPanel: (id: string) => boolean;
  toggleFold: (id: string) => void;
  setWeight: (id: string, weight: number) => void;
  // Two panels change places (and keep the sizes of the places).
  swapPanels: (a: string, b: string) => void;
  // The near column and the far one change places, widths going with them.
  swapColumns: () => void;
  toggleHidden: () => void;
  // Everything at once - a saved workspace put back (workspaceTemplates).
  replaceAll: (state: { panels: Panel[]; widths: [number, number]; hidden: boolean }) => void;
  // Whether a panel of this kind is showing, for the buttons that open it.
  has: (spec: OpenSpec) => boolean;
  // Open it, or close it when it is already open.
  toggle: (spec: OpenSpec) => void;
};

const WorkspaceContext = createContext<Workspace | null>(null);

// Null outside the laptop's shell - the phone never mounts a provider.
export function useWorkspace(): Workspace | null {
  return useContext(WorkspaceContext);
}

const same = (p: Panel, spec: OpenSpec) =>
  p.kind === spec.kind && (p.target && spec.target ? sameTarget(p.target, spec.target) : p.target === spec.target);

// Where the next panel goes: the first two each take a column of their own,
// after that they split the columns in turn, the near one first.
function columnForNext(count: number): 0 | 1 {
  if (count < 2) return count as 0 | 1;
  return ((count - 2) % 2) as 0 | 1;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [hidden, setHidden] = useState(false);
  const [widths, setWidths] = useState<[number, number]>([COLUMN_DEFAULT, COLUMN_DEFAULT]);

  const setWidth = useCallback(
    (column: 0 | 1, next: number) =>
      setWidths((prev) => {
        const clamped = Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, Math.round(next)));
        return column === 0 ? [clamped, prev[1]] : [prev[0], clamped];
      }),
    []
  );
  const add = useCallback((spec: OpenSpec, another: boolean) => {
    setHidden(false);
    setPanels((prev) => {
      const found = another ? undefined : prev.find((p) => same(p, spec));
      if (found) return prev.map((p) => (p === found ? { ...p, folded: false } : p));
      return [
        ...prev,
        { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...spec, column: columnForNext(prev.length) },
      ];
    });
  }, []);
  const open = useCallback((spec: OpenSpec) => add(spec, false), [add]);
  const openAtRoot = useCallback(
    (spec: OpenSpec) => {
      add(spec, false);
      setPanels((prev) => prev.map((p) => (same(p, spec) && p.stack?.length ? { ...p, stack: [] } : p)));
    },
    [add]
  );
  const openAnother = useCallback((spec: OpenSpec) => add(spec, true), [add]);
  const close = useCallback((id: string) => setPanels((prev) => prev.filter((p) => p.id !== id)), []);
  const panelsRef = useRef<Panel[]>([]);
  panelsRef.current = panels;
  const pushInPanel = useCallback(
    (id: string, target: PaneTarget) =>
      setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, stack: [...(p.stack ?? []), target] } : p))),
    []
  );
  const popInPanel = useCallback((id: string) => {
    const panel = panelsRef.current.find((p) => p.id === id);
    if (!panel?.stack?.length) return false;
    setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, stack: (p.stack ?? []).slice(0, -1) } : p)));
    return true;
  }, []);
  const toggleFold = useCallback(
    (id: string) => setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, folded: !p.folded } : p))),
    []
  );
  const setWeight = useCallback(
    (id: string, weight: number) => setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, weight } : p))),
    []
  );
  const swapPanels = useCallback((a: string, b: string) => {
    setPanels((prev) => {
      const i = prev.findIndex((p) => p.id === a);
      const j = prev.findIndex((p) => p.id === b);
      if (i < 0 || j < 0) return prev;
      const next = [...prev];
      // The panels trade places in the list, and their column and share
      // stay with the PLACE - so what is bigger stays bigger.
      const first = next[i];
      const second = next[j];
      next[i] = { ...second, column: first.column, weight: first.weight };
      next[j] = { ...first, column: second.column, weight: second.weight };
      return next;
    });
  }, []);
  const swapColumns = useCallback(() => {
    setPanels((prev) => prev.map((p) => ({ ...p, column: (p.column === 0 ? 1 : 0) as 0 | 1 })));
    setWidths((prev) => [prev[1], prev[0]]);
  }, []);
  const toggleHidden = useCallback(() => setHidden((v) => !v), []);
  const replaceAll = useCallback((state: { panels: Panel[]; widths: [number, number]; hidden: boolean }) => {
    setPanels(state.panels);
    setWidths(state.widths);
    setHidden(state.hidden);
  }, []);
  const has = useCallback((spec: OpenSpec) => panels.some((p) => same(p, spec)), [panels]);
  const toggle = useCallback(
    (spec: OpenSpec) => {
      const found = panels.find((p) => same(p, spec));
      if (found && !hidden) close(found.id);
      else open(spec);
    },
    [panels, hidden, open, close]
  );

  const value = useMemo<Workspace>(
    () => ({ panels, hidden, widths, setWidth, open, openAtRoot, openAnother, close, pushInPanel, popInPanel, toggleFold, setWeight, swapPanels, swapColumns, toggleHidden, replaceAll, has, toggle }),
    [panels, hidden, widths, setWidth, open, openAtRoot, openAnother, close, pushInPanel, popInPanel, toggleFold, setWeight, swapPanels, swapColumns, replaceAll, toggleHidden, has, toggle]
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
