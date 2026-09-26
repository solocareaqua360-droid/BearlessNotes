// The errors CrashBoundary can never see.
//
// A React error boundary catches what throws while RENDERING. It does not
// catch what throws later, on its own: a Firestore listener refused by the
// rules, a promise nobody awaited, a callback fired from native. React
// Native routes those to a global handler, and in a release build that
// handler tears the JS root down. The activity is left showing its own
// empty window - #FAFAFA, Android's default - and the only report anyone
// can make is "білий екран", which is the same report for every possible
// cause. This session spent an evening on exactly that.
//
// So the global handler is taken over: the error is kept and handed to
// whoever is listening (FatalErrorOverlay), and the default one is NOT
// called for a fatal, because calling it is what empties the screen.
type Listener = (error: Error) => void;

let listener: Listener | null = null;
let pending: Error | null = null;
let installed = false;

export function installFatalErrorReporter() {
  if (installed) return;
  installed = true;
  const utils = (globalThis as { ErrorUtils?: {
    getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
    setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
  } }).ErrorUtils;
  if (!utils?.setGlobalHandler || !utils.getGlobalHandler) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    const real = error instanceof Error ? error : new Error(String(error));
    if (listener) listener(real);
    else pending = real;
    // A non-fatal one goes on to the default handler (it only logs).
    // A fatal one does not: that call is what takes the screen away.
    if (!isFatal) previous?.(error, isFatal);
  });
}

export function onFatalError(next: Listener) {
  listener = next;
  if (pending) {
    const held = pending;
    pending = null;
    next(held);
  }
  return () => {
    if (listener === next) listener = null;
  };
}
