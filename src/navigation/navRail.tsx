import { ReactNode, useEffect, useId, useState } from 'react';

// What the desktop rail shows about the screen it is standing beside.
//
// The rail lives at the root, above every screen, and the folders belong
// to ONE screen - the list that is open. So the screen publishes and the
// rail reads, which is the same arrangement the dock already has (see
// navDock) and for the same reason: the thing that knows is not the
// thing that draws.
//
// Claims, also like the dock: two screens can be mounted at once (a list
// and a note in its pane), and withdrawing must remove only your own
// publication, never whatever replaced it.

export type RailBin = { count: number; active: boolean; onOpen: () => void };

export type RailTree = {
  // Every folder, "/"-nested, in no particular order - the rail builds
  // the tree out of them.
  paths: string[];
  // Where the list is standing. '' is the root.
  current: string;
  onGo: (path: string) => void;
  // Make one, inside the folder given. A button of its own rather than
  // a long press: holding a button is a phone's answer to having no
  // room for a second one, and a rail has room. It is also simply the
  // wrong gesture with a mouse - "затискання в ноутбуці не найкращій
  // варіант".
  onNewFolder?: (parent: string) => void;
  bin?: RailBin;
};

type Claim = { id: string; value: RailTree };

let claims: Claim[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function publish(id: string, value: RailTree | null) {
  claims = value === null ? claims.filter((c) => c.id !== id) : [...claims.filter((c) => c.id !== id), { id, value }];
  notify();
}

// Called by the screen that owns the folders. Publishing null (or
// unmounting) hands the rail back to whoever else is standing.
export function usePublishRailTree(value: RailTree | null): void {
  const id = useId();
  useEffect(() => {
    publish(id, value);
  });
  useEffect(() => () => publish(id, null), [id]);
}

export function useRailTree(): RailTree | null {
  const [tree, setTree] = useState<RailTree | null>(() => claims[claims.length - 1]?.value ?? null);
  useEffect(() => {
    const listener = () => setTree(claims[claims.length - 1]?.value ?? null);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return tree;
}


// The rail's second publication: not a folder tree, but whatever the
// screen wants standing in the rail under the sections. The calendar
// puts its month, its "today" and the day's history there - the month
// is NAVIGATION, and the rail is where this app keeps navigation, the
// same as the folders above.
//
// A node rather than a description of one, because there is nothing
// general to describe: a month grid and a folder tree have no shape in
// common, and inventing one would mean the rail knowing about both.
// The claims work exactly as the tree's do.

type PanelClaim = { id: string; value: ReactNode };

let panelClaims: PanelClaim[] = [];
const panelListeners = new Set<() => void>();

function publishPanel(id: string, value: ReactNode | null) {
  panelClaims =
    value === null
      ? panelClaims.filter((c) => c.id !== id)
      : [...panelClaims.filter((c) => c.id !== id), { id, value }];
  panelListeners.forEach((l) => l());
}

export function usePublishRailPanel(value: ReactNode | null): void {
  const id = useId();
  useEffect(() => {
    publishPanel(id, value);
  });
  useEffect(() => () => publishPanel(id, null), [id]);
}

export function useRailPanel(): ReactNode | null {
  const [panel, setPanel] = useState<ReactNode | null>(() => panelClaims[panelClaims.length - 1]?.value ?? null);
  useEffect(() => {
    const listener = () => setPanel(panelClaims[panelClaims.length - 1]?.value ?? null);
    panelListeners.add(listener);
    listener();
    return () => {
      panelListeners.delete(listener);
    };
  }, []);
  return panel;
}
