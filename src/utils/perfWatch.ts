// WHERE THE JS THREAD GOES (2026-10-05, temporary diagnosis). Notes opened
// slower and slower through a session and fast again after a restart; the
// openings themselves were measured and trimmed, and the user said the
// plain thing: "ми лікуємо симптоми". This watches the two suspects for
// something that ACCUMULATES - live Firestore listeners (counted and timed
// at the one door, firestore.ts) and stalls of the JS thread - and the
// opening report prints what it saw around the tap.

import { useLayoutEffect } from 'react';

type Run = { at: number; label: string; ms: number };

const live = new Map<string, number>();
const runs: Run[] = [];
const stalls: { at: number; ms: number }[] = [];
const renders: Run[] = [];
const KEEP_MS = 30000;

function trim(list: { at: number }[]) {
  const cutoff = Date.now() - KEEP_MS;
  while (list.length && list[0].at < cutoff) list.shift();
}

export function listenerStarted(label: string): void {
  live.set(label, (live.get(label) ?? 0) + 1);
}

export function listenerStopped(label: string): void {
  const n = (live.get(label) ?? 1) - 1;
  if (n <= 0) live.delete(label);
  else live.set(label, n);
}

export function snapshotHandled(label: string, ms: number): void {
  runs.push({ at: Date.now(), label, ms });
  trim(runs);
}

// How long a screen's render took, children and all: from its body starting
// to its own layout effect, which React runs after everything under it has
// been rendered and committed. Put at the top of the screens that stay
// mounted, it says whose re-render is holding the thread.
export function useRenderTimer(label: string): void {
  const start = Date.now();
  useLayoutEffect(() => {
    const ms = Date.now() - start;
    if (ms < 8) return;
    renders.push({ at: Date.now(), label, ms });
    trim(renders);
  });
}

// Told about a long stall the moment it is over (the app root hands in its
// notify). Not more than once in a while: it is a diagnosis, not an alarm.
let stallReporter: ((title: string, body: string) => void) | null = null;
let lastReport = 0;
export function setStallReporter(report: (title: string, body: string) => void): void {
  stallReporter = report;
}
const STALL_REPORT_MS = 600;

// The JS thread's own pulse: a timer that comes late was kept waiting by
// whatever held the thread.
const BEAT_MS = 100;
let expected = Date.now() + BEAT_MS;
setInterval(() => {
  const now = Date.now();
  const late = now - expected;
  expected = now + BEAT_MS;
  // Minutes "late" is the app having been away (Android stops its timers
  // in the background), not a stall.
  if (late > 10000) return;
  if (late > 150) {
    stalls.push({ at: now, ms: late });
    trim(stalls);
  }
  if (late > STALL_REPORT_MS && stallReporter && now - lastReport > 20000) {
    lastReport = now;
    const report = stallReporter;
    // After this tick, so the summary includes whatever finished in it.
    setTimeout(() => report(`Застосунок завис на ${(late / 1000).toFixed(1)} с`, perfSummary(now - late - 1500)), 0);
  }
}, BEAT_MS);

// What was going on from `since` until now, in one line.
export function perfSummary(since: number): string {
  trim(runs);
  trim(stalls);
  trim(renders);
  const total = Array.from(live.values()).reduce((a, b) => a + b, 0);
  const top = Array.from(live.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, n]) => `${label}×${n}`)
    .join(', ');
  const recent = runs.filter((r) => r.at >= since);
  const byLabel = new Map<string, { n: number; ms: number }>();
  recent.forEach((r) => {
    const s = byLabel.get(r.label) ?? { n: 0, ms: 0 };
    s.n += 1;
    s.ms += r.ms;
    byLabel.set(r.label, s);
  });
  const spent = recent.reduce((a, r) => a + r.ms, 0);
  const heavy = Array.from(byLabel.entries())
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 4)
    .map(([label, s]) => `${label} ${s.n}×=${Math.round(s.ms)}`)
    .join(', ');
  const late = stalls.filter((s) => s.at >= since);
  const worst = late.reduce((m, s) => Math.max(m, s.ms), 0);
  const drawn = renders.filter((r) => r.at >= since);
  const byScreen = new Map<string, { n: number; ms: number }>();
  drawn.forEach((r) => {
    const s = byScreen.get(r.label) ?? { n: 0, ms: 0 };
    s.n += 1;
    s.ms += r.ms;
    byScreen.set(r.label, s);
  });
  const screens = Array.from(byScreen.entries())
    .sort((a, b) => b[1].ms - a[1].ms)
    .map(([label, s]) => `${label} ${s.n}×=${Math.round(s.ms)}`)
    .join(', ');
  return [
    `рендери: ${screens || 'немає'}`,
    `слухачів ${total} (${top})`,
    `знімків ${recent.length} = ${Math.round(spent)} мс${heavy ? ` (${heavy})` : ''}`,
    `зависань ${late.length}${late.length ? `, найдовше ${Math.round(worst)} мс` : ''}`,
  ].join('\n');
}
