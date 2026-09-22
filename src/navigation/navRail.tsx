import { useEffect, useId, useState } from 'react';

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
