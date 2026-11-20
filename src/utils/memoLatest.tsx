import { memo, useMemo, useRef, type ComponentType } from 'react';

// A PIECE THAT DRAWS AGAIN ONLY WHEN WHAT IT SHOWS CHANGES (2026-11-16, the optimisation pass, measured: coming back to the
// Start drew all its rows again - 23 rows, 3 heads, the recents, «Думки», «Обране», «Бази» - with nothing changed, ~40 ms
// of every return and every capsule switch). Plain `memo` did not help: the screen hands each row a fresh arrow for its tap
// on every render, so the props were never «the same». Here the functions do not count: the piece is compared by its other
// props, and each function it was given is a stable stand-in that always calls the LATEST one handed down - so a skipped
// redraw never leaves a row calling yesterday's handler.
type AnyProps = Record<string, unknown>;

function sameExceptFunctions(a: AnyProps, b: AnyProps): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const x = a[k];
    const y = b[k];
    if (typeof x === 'function' || typeof y === 'function') {
      // Present on one side only is a change (a row that gained a hold menu).
      if (typeof x !== typeof y) return false;
      continue;
    }
    if (!Object.is(x, y)) return false;
  }
  return true;
}

export function memoLatest<P extends object>(Component: ComponentType<P>): ComponentType<P> {
  const Inner = memo(Component as ComponentType<AnyProps>, sameExceptFunctions);
  function Latest(props: P) {
    const latest = useRef(props as AnyProps);
    latest.current = props as AnyProps;
    const standIns = useMemo(() => new Map<string, (...args: unknown[]) => unknown>(), []);
    const passed: AnyProps = {};
    for (const [k, v] of Object.entries(props as AnyProps)) {
      if (typeof v !== 'function') {
        passed[k] = v;
        continue;
      }
      let fn = standIns.get(k);
      if (!fn) {
        fn = (...args: unknown[]) => (latest.current[k] as ((...a: unknown[]) => unknown) | undefined)?.(...args);
        standIns.set(k, fn);
      }
      passed[k] = fn;
    }
    return <Inner {...passed} />;
  }
  Latest.displayName = `memoLatest(${Component.displayName ?? Component.name ?? 'Component'})`;
  return Latest as ComponentType<P>;
}
