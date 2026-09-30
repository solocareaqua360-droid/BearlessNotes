import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
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
};

export const COLUMN_MIN = 260;
export const COLUMN_MAX = 640;
export const COLUMN_DEFAULT = 380;

export type OpenSpec = { kind: PanelKind; target?: PaneTarget };

type Workspace = {
  panels: Panel[];
  // The whole side area put away (its panels keep their place).
  hidden: boolean;
  // One column's width; two columns are two of these.
  width: number;
  setWidth: (width: number) => void;
  // Opens a panel - or, if one like it is already there, shows it.
  open: (spec: OpenSpec) => void;
  // Always a NEW panel, even if the same thing is already open elsewhere
  // (a second look at a database, with another filter).
  openAnother: (spec: OpenSpec) => void;
  close: (id: string) => void;
  toggleFold: (id: string) => void;
  toggleHidden: () => void;
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
  const [width, setWidthState] = useState(COLUMN_DEFAULT);

  const setWidth = useCallback(
    (next: number) => setWidthState(Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, Math.round(next)))),
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
  const openAnother = useCallback((spec: OpenSpec) => add(spec, true), [add]);
  const close = useCallback((id: string) => setPanels((prev) => prev.filter((p) => p.id !== id)), []);
  const toggleFold = useCallback(
    (id: string) => setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, folded: !p.folded } : p))),
    []
  );
  const toggleHidden = useCallback(() => setHidden((v) => !v), []);
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
    () => ({ panels, hidden, width, setWidth, open, openAnother, close, toggleFold, toggleHidden, has, toggle }),
    [panels, hidden, width, setWidth, open, openAnother, close, toggleFold, toggleHidden, has, toggle]
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
