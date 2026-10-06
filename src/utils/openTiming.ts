// WHERE A SLOW OPENING WENT (2026-10-05, temporary): the user saw a note now
// and then take up to two seconds to open, at random, on a phone with power
// to spare. The way in has several waits - the card measured, the chrome
// photographed (chromeMorph), the push, the note read (cache or server),
// the first draw - and only measuring says which one it was. The editor
// reports an opening slower than SLOW_MS, step by step.
// Zero: every opening is kept (quietly, for «Діагностика») with its steps.
export const SLOW_OPEN_MS = 0;
// Off since 2026-10-06 - the openings were measured; see perfWatch.
export const SHOW_OPEN_REPORTS = false;

let marks: Record<string, number> = {};

export function openMark(name: 'tap' | 'measured' | 'chrome' | 'push' | 'landed' | 'moving'): void {
  if (name === 'tap') marks = {};
  marks[name] = Date.now();
}

// The marks of the opening in progress - none when the last tap is too old
// to belong to it (a note opened another way).
export function takeOpenMarks(): Record<string, number> {
  const taken = marks;
  marks = {};
  return taken.tap && Date.now() - taken.tap < 15000 ? taken : {};
}
