import type { ComponentType } from 'react';
import { useLeaving } from '../hooks/useLeaving';

// A CLOSED WINDOW COSTS NOTHING (2026-11-16, the optimisation pass; see GlassLayer, which does the same inside): a screen
// keeps every window it can open mounted, and each of its re-renders ran each closed window's hooks - the keyboard's
// height, animated styles, the bottom-sheet clock. Wrapped, a window is built when it opens and kept until `lingerMs` after
// it closes (long enough for its way out), then let go; its own state starts fresh on the next opening.
export function closedCostsNothing<P extends { visible: boolean }>(Window: ComponentType<P>, lingerMs: (props: P) => number): ComponentType<P> {
  function Gate(props: P) {
    const { mounted } = useLeaving(props.visible, lingerMs(props));
    if (!mounted) return null;
    return <Window {...props} />;
  }
  Gate.displayName = `closedCostsNothing(${Window.displayName ?? Window.name ?? 'Window'})`;
  return Gate;
}
