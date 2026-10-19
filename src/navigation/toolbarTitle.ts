import { useEffect, useId, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';

// THE WINDOW BAR'S TITLE (the Mac's frame B, 2026-10-20): a screen with a name of its own - a board, so far - says it
// here and the window toolbar draws «Дошки / назва ⌄» after the way back, instead of the screen painting a grey pill over
// its own canvas. Same shape as navRail's panel: claims by screen, the front one wins, only while the screen is in front.
export type ToolbarTitle = { parent?: string; title: string; onParent?: () => void; onRename?: () => void };

let claims: { id: string; value: ToolbarTitle }[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const same = (a?: ToolbarTitle, b?: ToolbarTitle) => !!a && !!b && a.title === b.title && a.parent === b.parent;

function publish(id: string, value: ToolbarTitle | null) {
  const old = claims.find((c) => c.id === id)?.value;
  if (value === null ? old === undefined : same(old, value)) {
    // Same words: keep the newest callbacks without waking anyone.
    if (value && old) claims = claims.map((c) => (c.id === id ? { id, value } : c));
    return;
  }
  claims = value === null ? claims.filter((c) => c.id !== id) : [...claims.filter((c) => c.id !== id), { id, value }];
  emit();
}

export function usePublishToolbarTitle(value: ToolbarTitle | null): void {
  const id = useId();
  const focused = useIsFocused();
  useEffect(() => {
    publish(id, focused ? value : null);
  });
  useEffect(() => () => publish(id, null), [id]);
}

export function useToolbarTitle(): ToolbarTitle | null {
  const [t, setT] = useState<ToolbarTitle | null>(() => claims[claims.length - 1]?.value ?? null);
  useEffect(() => {
    const l = () => setT(claims[claims.length - 1]?.value ?? null);
    listeners.add(l);
    l();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return t;
}
