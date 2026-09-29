import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';

// THE LAPTOP'S WORKSPACE (Mac stage 6): the main pane in the middle, and a
// column of side panels on the right - the databases list, one database
// held open, the chat. The shape is the one Claude Code's window has, but
// not its limit: a phone stops at a few because its screen does, a laptop
// has no such reason. So there is no cap - the column scrolls when the
// panels no longer fit, and any of them folds to its header.
//
// The main pane is the navigator, unchanged. These panels stand BESIDE
// it, the way the rail does, and each one is a whole screen with its own
// dock publications and its own frame size (see PaneScreen).
export type PanelKind = 'databases' | 'database' | 'chat';

export type Panel = {
  id: string;
  kind: PanelKind;
  databaseId?: string;
  // Folded to its header, the column keeping its place.
  folded?: boolean;
};

export const COLUMN_MIN = 300;
export const COLUMN_MAX = 640;
export const COLUMN_DEFAULT = 380;

export type OpenSpec = { kind: PanelKind; databaseId?: string };

type Workspace = {
  panels: Panel[];
  // The whole column put away (its panels keep their place).
  hidden: boolean;
  width: number;
  setWidth: (width: number) => void;
  // Opens a panel - or, if one like it is already there, shows it.
  open: (spec: OpenSpec) => void;
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

const same = (p: Panel, spec: OpenSpec) => p.kind === spec.kind && (p.databaseId ?? null) === (spec.databaseId ?? null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [hidden, setHidden] = useState(false);
  const [width, setWidthState] = useState(COLUMN_DEFAULT);

  const setWidth = useCallback(
    (next: number) => setWidthState(Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, Math.round(next)))),
    []
  );
  const open = useCallback((spec: OpenSpec) => {
    setHidden(false);
    setPanels((prev) => {
      const found = prev.find((p) => same(p, spec));
      if (found) return prev.map((p) => (p === found ? { ...p, folded: false } : p));
      return [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...spec }];
    });
  }, []);
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
    () => ({ panels, hidden, width, setWidth, open, close, toggleFold, toggleHidden, has, toggle }),
    [panels, hidden, width, setWidth, open, close, toggleFold, toggleHidden, has, toggle]
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
