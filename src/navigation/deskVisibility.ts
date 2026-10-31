import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

// WHETHER A DESK (OR A DRAWER) IS ON SCREEN, readable without rendering
// (2026-10-06, the preview plan's stage 1). A frozen desk (components/
// Freeze) does not render when the app around it does - but its OWN data
// kept arriving: every autosave of a note handed every documents listener
// on every desk a new collection, and React rendered the frozen desks
// anyway, later, at idle priority - which on a phone was often the moment
// of the next tap (measured: Старт, Календар, Бази four times each around
// one note opened). A frozen subtree cannot be told anything through
// context - it does not render to hear it - so the host keeps a plain box
// it flips directly, and listeners inside read it at the moment data comes.
export type VisibilityBox = { visible: boolean; shown: Set<() => void> };

const ALWAYS: VisibilityBox = { visible: true, shown: new Set() };

export const DeskVisibilityContext = createContext<VisibilityBox>(ALWAYS);

export function makeVisibilityBox(visible: boolean): VisibilityBox {
  return { visible, shown: new Set() };
}

export function setBoxVisible(box: VisibilityBox, visible: boolean): void {
  if (box.visible === visible) return;
  box.visible = visible;
  if (visible) box.shown.forEach((fn) => fn());
}

// `gated(key, run)` inside a data callback: on screen `run` goes at once;
// out of sight only the LATEST run per key is kept, and made the moment the
// desk is shown again - one render on arrival instead of one per change
// while away.
export function useDeskGate() {
  const box = useContext(DeskVisibilityContext);
  const pending = useRef(new Map<string, () => void>());
  useEffect(() => {
    const flush = () => {
      const waiting = Array.from(pending.current.values());
      pending.current.clear();
      waiting.forEach((run) => run());
    };
    box.shown.add(flush);
    return () => {
      box.shown.delete(flush);
    };
  }, [box]);
  return useCallback(
    (key: string, run: () => void) => {
      if (box.visible) run();
      else pending.current.set(key, run);
    },
    [box]
  );
}
