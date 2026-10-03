import { useEffect, useState } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

// THE DESKS' PICTURES, for the tab switcher (components/DeskSwitcher): what
// each open desk last looked like, as a small photograph. Each desk's own
// wrapper registers itself here (Tabs' DeskHost); a desk is photographed a
// moment after it settles in front, and again as the switcher opens, so the
// picture is the desk as it was left. A desk never visited has none and
// the switcher draws its icon instead.
const nodes = new Map<string, View>();
const shots = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function registerDeskNode(key: string, node: View | null) {
  if (node) nodes.set(key, node);
  else nodes.delete(key);
}

export async function captureDesk(key: string): Promise<void> {
  const node = nodes.get(key);
  if (!node) return;
  try {
    const uri = await captureRef(node, { format: 'jpg', quality: 0.6, result: 'tmpfile', width: 420 });
    shots.set(key, uri);
    notify();
  } catch {
    // Keeps the last picture it had.
  }
}

// A closed desk's picture goes with it.
export function forgetDesk(key: string) {
  if (shots.delete(key)) notify();
}

export function useDeskShots(): Record<string, string> {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return Object.fromEntries(shots);
}
