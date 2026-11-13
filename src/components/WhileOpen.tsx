import { ReactNode, useEffect, useState } from 'react';

// A SHEET THAT IS NOT OPEN IS NOT THERE (2026-10-06, the preview plan).
// A screen keeps a dozen sheets mounted - pickers, editors, menus - each
// with `visible={false}` almost all the time, and every one of them was
// rendered, hooks and all, every time the screen was: on every note opened
// and closed. Wrapped in this, a sheet exists only while it is open and
// for a moment after it closes, so its own close animation still plays.
const LINGER_MS = 600;

export default function WhileOpen({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), LINGER_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return open || mounted ? <>{children}</> : null;
}
