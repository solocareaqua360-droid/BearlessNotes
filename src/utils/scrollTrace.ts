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

export type TraceEvent = { t: number; src: string; text: string; count?: number };

const events: TraceEvent[] = [];
let burstStart = 0;
let lastAt = 0;
const listeners = new Set<() => void>();

// A pause of more than two seconds starts a fresh list, so every tap is
// read from zero instead of being mixed into the last one.
// `tag` says WHICH editor wrote the line. The first run showed two
// content heights growing in step - two editors alive at once, both
// answering the same keyboard - and without a tag the two streams were
// one unreadable list.
export function traceScroll(src: string, text: string, tag = '') {
  const now = Date.now();
  if (now - lastAt > 2000) {
    events.length = 0;
    burstStart = now;
  }
  lastAt = now;
  const key = `${tag}${src}`;
  // A stream that repeats - an animated scroll, a spacer growing with the
  // keyboard frame by frame - collapses into ONE line showing where it
  // started and where it has got to. Uncollapsed, the first run's sixteen
  // lines were all "size" and pushed out every line that mattered.
  const same = [...events].reverse().find((e) => e.src === key);
  if ((src === 'scroll' || src === 'size') && same && events.indexOf(same) >= events.length - 4) {
    same.text = `${same.text.split('→')[0]}→${text}`;
    same.count = (same.count ?? 1) + 1;
  } else {
    events.push({ t: now - burstStart, src: key, text });
    if (events.length > 22) events.shift();
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
