import { useEffect, useRef, useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import HoldMenu, { type HoldAction } from '../HoldMenu';
import { ask, type AskOptions } from './Ask';
import { takeHeldNode } from '../../utils/heldNode';
import { hapticPickUp } from '../../utils/haptics';

// A QUESTION A HOLD ASKS - "що з цим зробити" - as the chat asks it: a buzz,
// everything else out of focus behind a blur, the held thing itself lifted
// sharp where it stands (a photograph of it, so any card of any shape is
// itself), and the choices beside it. "Треба всюди поробити контекстне
// меню ... не повноцінна панель на весь екран ... а як в чаті і з
// вібровідгуком" (2026-10-02).
//
// Same promise as ask(): the chosen id, or 'cancel'. Nothing held just now
// (a "..." button, the laptop's right click) - it IS ask(), unchanged.

type Rect = { x: number; y: number; width: number; height: number };
type Pending = { options: AskOptions; rect: Rect; uri: string | null; resolve: (id: string) => void };

let queue: Pending[] = [];
let listener: (() => void) | null = null;

function measure(node: View): Promise<Rect | null> {
  return new Promise((resolve) => {
    try {
      node.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
    } catch {
      resolve(null);
    }
  });
}

export async function holdAsk(options: AskOptions, node: View | null = takeHeldNode()): Promise<string> {
  if (!node || Platform.OS === 'web') return ask(options);
  hapticPickUp();
  const rect = await measure(node);
  if (!rect) return ask(options);
  let uri: string | null = null;
  try {
    uri = await captureRef(node, { format: 'png', result: 'tmpfile' });
  } catch {
    uri = null;
  }
  return new Promise((resolve) => {
    queue = [...queue, { options, rect, uri, resolve }];
    listener?.();
  });
}

// Mounted once at the root, beside AskHost.
export function HoldAskHost() {
  const [current, setCurrent] = useState<Pending | null>(null);
  const answered = useRef(false);
  useEffect(() => {
    const next = () => {
      setCurrent((now) => {
        if (now || queue.length === 0) return now;
        const [first, ...rest] = queue;
        queue = rest;
        answered.current = false;
        return first;
      });
    };
    listener = next;
    next();
    return () => {
      if (listener === next) listener = null;
    };
  }, []);

  const answer = (id: string) => {
    if (!current || answered.current) return;
    answered.current = true;
    current.resolve(id);
  };

  const actions: HoldAction[] = (current?.options.actions ?? []).map((a) => ({
    key: a.id,
    label: a.label,
    icon: a.icon ?? 'ellipse-outline',
    tone: a.tone === 'danger' ? 'danger' : undefined,
    onPress: () => answer(a.id),
  }));

  return (
    <HoldMenu
      anchor={current?.rect ?? null}
      card={
        current?.uri ? (
          <Image source={{ uri: current.uri }} style={{ width: current.rect.width, height: current.rect.height }} />
        ) : null
      }
      actions={actions}
      onClose={() => {
        answer('cancel');
        setCurrent(null);
        // The next one waiting, if a hold came while this was open.
        setTimeout(() => listener?.(), 0);
      }}
    />
  );
}
