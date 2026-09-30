import { createContext, ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';

// ONE WAY BACK PER WINDOW (the laptop's). A window - the main pane, a side
// panel - has one back arrow in one place, and it always goes one level UP
// in that same window, never sideways into another tab. What "up" is comes
// from two places:
//
//   a step INSIDE the screen in front - a day of the diary open over its
//   list, a folder of a list open inside it - which only the screen knows,
//   so the screen says so here (useInnerBack);
//
//   otherwise the level above the screen itself - the panel's own history,
//   or, in the main pane, the list or place the screen belongs to (see
//   UpButton's callers).
//
// With neither, there is no arrow at all. A phone never mounts a provider,
// so there this is a no-op.
type Claim = { id: string; run: () => void };
type Ctx = { publish: (id: string, run: (() => void) | null) => void; current: (() => void) | null };

const InnerBackContext = createContext<Ctx | null>(null);

export function InnerBackProvider({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const publish = useCallback((id: string, run: (() => void) | null) => {
    setClaims((prev) => {
      const rest = prev.filter((c) => c.id !== id);
      return run ? [...rest, { id, run }] : rest.length === prev.length ? prev : rest;
    });
  }, []);
  const current = claims.length ? claims[claims.length - 1].run : null;
  const value = useMemo(() => ({ publish, current }), [publish, current]);
  return <InnerBackContext.Provider value={value}>{children}</InnerBackContext.Provider>;
}

// A screen's own step back inside itself, while it has one; null when it
// is at its top.
export function useInnerBack(run: (() => void) | null) {
  const ctx = useContext(InnerBackContext);
  const focused = useIsFocused();
  const id = useId();
  const ref = useRef(run);
  ref.current = run;
  const active = !!run && focused;
  useEffect(() => {
    if (!ctx) return;
    ctx.publish(id, active ? () => ref.current?.() : null);
    return () => ctx.publish(id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.publish, id, active]);
}

export function useInnerBackNow(): (() => void) | null {
  return useContext(InnerBackContext)?.current ?? null;
}
