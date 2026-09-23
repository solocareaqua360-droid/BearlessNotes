import { useEffect, useState } from 'react';

// A DIAGNOSTIC, and a temporary one. It exists to answer one question the
// code could not: who moves the note's page by half a line when a field
// is tapped. Three readings of the source guessed three different
// culprits; this records what actually happens, in order, with the time
// since the tap, and the editor draws it on screen so a phone screenshot
// carries the answer.
//
// Remove this file, its overlay and every traceScroll() call once the
// jerk is found - see DIAG in DocumentEditorScreen.

export type TraceEvent = { t: number; src: string; text: string };

const events: TraceEvent[] = [];
let burstStart = 0;
let lastAt = 0;
const listeners = new Set<() => void>();

// A pause of more than two seconds starts a fresh list, so every tap is
// read from zero instead of being mixed into the last one.
export function traceScroll(src: string, text: string) {
  const now = Date.now();
  if (now - lastAt > 2000) {
    events.length = 0;
    burstStart = now;
  }
  lastAt = now;
  const last = events[events.length - 1];
  // An animated scroll fires dozens of times; one line per scroll, with
  // its start and where it has got to, is what can be read on a phone.
  if (src === 'scroll' && last && last.src === 'scroll') {
    last.text = `${last.text.split('→')[0]}→${text}`;
  } else {
    events.push({ t: now - burstStart, src, text });
    if (events.length > 16) events.shift();
  }
  listeners.forEach((l) => l());
}

export function useScrollTrace(): TraceEvent[] {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return events;
}
