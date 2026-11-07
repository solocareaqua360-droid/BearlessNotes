import { useSyncExternalStore } from 'react';
import type { FolderEntry } from '../screens/ExplorerScreen';
import type { FolderItem } from '../hooks/useAllFolderItems';
import type { Tag } from '../types';
import type { Rect4 } from '../components/ProjectFolders';

// THE FOLDER BEING OPENED, OUTSIDE THE EXPLORER (2026-10-19). Held as the explorer's own state, a tap on a folder
// re-rendered the whole explorer (~2300 lines) before the opening could even start: ~0.2 s with nothing moving on
// screen, measured frame by frame. Kept here, the tap sets it and only the small layer that draws the opening
// (ExplorerScreen's FolderGrowLayer) and what asks about it re-render.
export type FolderOpening = {
  tag: Tag;
  from: Rect4;
  path: string;
  entry: FolderEntry;
  // Worked out at the tap, so the layer needs nothing from the explorer.
  mine: FolderItem[];
  subs: number;
  subNames: string[];
  ground: string;
  // The host steps into the folder (FolderGrow's onGrown).
  onGrown: () => void;
};

type State = { opening: FolderOpening | null; ready: boolean };
let state: State = { opening: null, ready: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const folderOpening = {
  get: () => state.opening,
  // A new opening; not ready until the folder underneath says its cover is drawn.
  start(opening: FolderOpening) {
    state = { opening, ready: false };
    emit();
  },
  // The folder at `path` is drawn underneath - only for the opening of that folder.
  ready(path: string) {
    if (!state.opening || state.opening.path !== path || state.ready) return;
    state = { ...state, ready: true };
    emit();
  },
  clear() {
    if (!state.opening) return;
    state = { opening: null, ready: false };
    emit();
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFolderOpening(): State {
  return useSyncExternalStore(subscribe, () => state);
}
