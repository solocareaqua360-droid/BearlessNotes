import { createContext, useContext } from 'react';

// A screen drawn INSIDE the phone's databases drawer (DatabasesScreen's
// in-drawer pane): the drawer already draws a bar over it, with the
// screen's name, its "⋯" and the way back - fed from what the screen
// publishes. So the screen lays itself out under a bar, publishes to it
// as a pushed database would, and draws no bar of its own.
export const PaneBarContext = createContext(false);

export function usePaneBar(): boolean {
  return useContext(PaneBarContext);
}
