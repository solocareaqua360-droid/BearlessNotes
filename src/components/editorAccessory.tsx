import { ReactNode, useEffect, useId, useState } from 'react';

// What a BLOCK wants standing above the keyboard, in place of the
// editor's own toolbar.
//
// The editor already solves the hard half of this. Its pinned toolbar
// sits at `bottom: keyboardSV.value`, driven frame by frame from the
// keyboard's own animation on the UI thread, and it mounts off
// `focusedBlockId` rather than off any keyboard event - a whole night in
// September went into learning that a value written by event listeners
// is not something to mount a bar over, because one spurious event
// flashed the whole thing away and back. None of that is worth solving
// twice.
//
// So a block does not build its own bar above the keyboard. It publishes
// what belongs there, and the editor draws it in the place it has
// already made safe. The table is the first: from the moment a cell's
// text starts with "=", the formula field is what should be under the
// thumb, not the block-type buttons.
//
// Claims, the same as navDock and navRail: two blocks can be mounted at
// once (a note in a pane beside a list), and withdrawing must remove
// only your own publication, never whatever replaced it.

type Claim = { id: string; value: ReactNode };

let claims: Claim[] = [];
const listeners = new Set<() => void>();

function publish(id: string, value: ReactNode | null) {
  claims = value === null ? claims.filter((c) => c.id !== id) : [...claims.filter((c) => c.id !== id), { id, value }];
  listeners.forEach((l) => l());
}

// With DEPS, unlike navDock and navRail - and this is not a style choice.
// Those are read by the rail and the dock, which stand beside the
// screens. This one is read by the EDITOR, which is the ANCESTOR of the
// block that publishes it: publishing on every render made the editor
// re-render, which re-rendered the table, which published again, and
// React stopped it at "Maximum update depth exceeded" (error #185) the
// first time a formula cell was tapped. Publishing only when what is
// actually IN the bar changes is what breaks that circle.
export function usePublishEditorAccessory(value: ReactNode | null, deps: unknown[]): void {
  const id = useId();
  useEffect(() => {
    publish(id, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => () => publish(id, null), [id]);
}

export function useEditorAccessory(): ReactNode | null {
  const [node, setNode] = useState<ReactNode | null>(() => claims[claims.length - 1]?.value ?? null);
  useEffect(() => {
    const listener = () => setNode(claims[claims.length - 1]?.value ?? null);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return node;
}
