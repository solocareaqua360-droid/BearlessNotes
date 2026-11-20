// react-dom is react-native-web's own renderer, already in the bundle; its
// types are not installed (no new dependency for them), hence the require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { flushSync } = require('react-dom') as { flushSync: (fn: () => void) => void };

// A CHANGE OF LAYOUT THAT MOVES (the soft motion, stage 2): the browser
// takes a picture of the window before and after `update` and moves every
// named piece (view-transition-name - the main pane, the panels) from where
// it was to where it is, cross-fading its content. The rules for how are one
// block of CSS in App.web.tsx.
//
// `update` is run inside flushSync, so React has drawn the new layout before
// the browser takes its "after" picture. With reduced motion asked for, or a
// browser without the API, the change simply happens.
//
// `after` runs once the new layout is drawn and before the browser's
// "after" picture (a name handed to what just appeared - see utils/morph).
// It may return a promise: the picture then waits for it, the window held
// still on the old one - for a screen that draws its content a beat after
// it mounts. `done` runs once the move is over, or at once when there is
// no move.
let running = false;

export function withTransition(update: () => void, after?: () => void | Promise<void>, done?: () => void): void {
  const start = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // One at a time: a second change while one is moving just happens.
  if (!start || reduced || running) {
    update();
    after?.();
    done?.();
    return;
  }
  running = true;
  const transition = start.call(document, () => {
    flushSync(update);
    return after?.();
  }) as { finished?: Promise<void> };
  const over = () => {
    running = false;
    done?.();
  };
  if (transition?.finished) transition.finished.then(over, over);
  else over();
}
