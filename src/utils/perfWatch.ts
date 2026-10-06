// WHERE THE JS THREAD GOES (2026-10-05, temporary diagnosis). Notes opened
// slower and slower through a session and fast again after a restart; the
// openings themselves were measured and trimmed, and the user said the
// plain thing: "ми лікуємо симптоми". This watches the two suspects for
// something that ACCUMULATES - live Firestore listeners (counted and timed
// at the one door, firestore.ts) and stalls of the JS thread - and the
// opening report prints what it saw around the tap.

import { useLayoutEffect, useRef } from 'react';

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
    const now = Date.now();
    noteRender(label, now);
    const ms = now - start;
    if (ms < 8) return;
    renders.push({ at: now, label, ms });
    trim(renders);
  });
}

// WHY a screen drew again (2026-10-06): the counts said «Шторка папок 4x»
// and the props looked stable. Each render's inputs are compared with the
// last one's and the ones that changed are named; «власний стан» means no
// input changed - the component's own state or a context it reads.
const whys: { at: number; text: string }[] = [];
export function useWhyRender(label: string, inputs: Record<string, unknown>): void {
  const last = useRef<Record<string, unknown> | null>(null);
  const before = last.current;
  last.current = inputs;
  if (!before) return;
  const changed = Object.keys(inputs).filter((k) => !Object.is(inputs[k], before[k]));
  whys.push({ at: Date.now(), text: `${label}: ${changed.join('+') || 'власний стан'}` });
  trim(whys);
}

// A RENDER LOOP (two pieces setting each other's state, round and round)
// does not stall the thread in one long piece the pulse below would see -
// it keeps it busy in many short ones, and taps wait behind them for ever:
// the start desk that "froze until a restart". Counted per screen here;
// one that renders more than LOOP_RENDERS times in LOOP_WINDOW_MS is named.
const LOOP_RENDERS = 40;
const LOOP_WINDOW_MS = 2000;
const renderTimes = new Map<string, number[]>();
let lastLoopReport = 0;
function noteRender(label: string, now: number) {
  const times = renderTimes.get(label) ?? [];
  times.push(now);
  while (times.length && times[0] < now - LOOP_WINDOW_MS) times.shift();
  renderTimes.set(label, times);
  if (times.length > LOOP_RENDERS && now - lastLoopReport > 15000) {
    lastLoopReport = now;
    const report = logReport;
    const others = Array.from(renderTimes.entries())
      .map(([l, t]) => [l, t.filter((x) => x >= now - LOOP_WINDOW_MS).length] as const)
      .filter(([, n]) => n > 5)
      .sort((a, b) => b[1] - a[1])
      .map(([l, n]) => `${l} ${n}`)
      .join(', ');
    setTimeout(
      () => report(`«${label}» перемальовується без зупинки`, `${times.length} разів за 2 с\nразом із ним: ${others}\n\n${perfSummary(now - 3000)}`),
      0
    );
  }
}

// Told about a long stall the moment it is over (the app root hands in its
// notify). Not more than once in a while: it is a diagnosis, not an alarm.
//
// SILENT BY DEFAULT since 2026-10-06: the causes were found, and windows
// popping up over the app only made it feel broken ("як ранений хворий
// звір"). Flip REPORTS on to hear them again; everything is still counted.
const REPORTS = false;
let stallReporter: ((title: string, body: string) => void) | null = null;

// Every report is kept (the last few), shown or not - the Documents' "⋯"
// «Діагностика» reads them back when asked.
const kept: { at: number; title: string; body: string }[] = [];
export function logReport(title: string, body: string): void {
  kept.push({ at: Date.now(), title, body });
  while (kept.length > 8) kept.shift();
  if (REPORTS) stallReporter?.(title, body);
}
export function recentReports(): string {
  if (kept.length === 0) return 'Нічого не записано.';
  const now = Date.now();
  return kept
    .slice()
    .reverse()
    .map((r) => `${Math.round((now - r.at) / 1000)} с тому · ${r.title}\n${r.body}`)
    .join('\n\n');
}

// HOW LONG A TOUCH WAITED for the JS thread (2026-10-06: "процес
// невидимий, але він відбувається і заморожує дії"). A touch carries the
// time the phone saw it; the gap to the moment JS hears it, minus the
// smallest gap ever seen (the clocks' own offset), is how long it waited.
let minGap = Infinity;
let lastTouchReport = 0;
export function touchArrived(nativeTimestamp: number): void {
  if (!nativeTimestamp) return;
  const gap = Date.now() - nativeTimestamp;
  if (gap < minGap) minGap = gap;
  const waited = gap - minGap;
  if (waited > 150 && Date.now() - lastTouchReport > 3000) {
    lastTouchReport = Date.now();
    logReport(`Дотик чекав ${waited} мс`, perfSummary(Date.now() - waited - 1500));
  }
}
let lastReport = 0;
export function setStallReporter(report: (title: string, body: string) => void): void {
  stallReporter = REPORTS ? report : null;
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
  if (late > STALL_REPORT_MS && now - lastReport > 20000) {
    lastReport = now;
    const report = logReport;
    // After this tick, so the summary includes whatever finished in it.
    setTimeout(() => report(`Застосунок завис на ${(late / 1000).toFixed(1)} с`, perfSummary(now - late - 1500)), 0);
  }
}, BEAT_MS);

// THE WAY BACK from a note, timed (2026-10-05): the second after a fold in
// which nothing can be pressed. 'pop' when the note is let go, 'focus' when
// the desks are in front again, then the first frame after.
let backPop = 0;
let backFocus = 0;
// The editor's own unmount: its first cleanup, and the first moment after
// the commit that ran it (the whole tree is gone by then).
let goneStart = 0;
let goneEnd = 0;
export function markEditorGone(): void {
  goneStart = Date.now();
  goneEnd = 0;
  setTimeout(() => {
    goneEnd = Date.now();
  }, 0);
}
export function backMarkPop(): void {
  backPop = Date.now();
  backFocus = 0;
}
export function backMarkFocus(): void {
  if (!backPop || backFocus) return;
  backFocus = Date.now();
  const pop = backPop;
  const focus = backFocus;
  requestAnimationFrame(() => {
    const frame = Date.now();
    backPop = 0;
    // The second half: whatever still holds the thread after the frame -
    // ticks are queued until one comes back promptly (the thread is free).
    let last = Date.now();
    const idle = (then: () => void) => {
      setTimeout(() => {
        const now = Date.now();
        const late = now - last;
        last = now;
        if (late < 30 || now - frame > 3000) then();
        else idle(then);
      }, 0);
    };
    idle(() => {
      const settled = last;
      const total = settled - pop;
      if (total < 300) return;
      logReport(
        `Повернення тривало ${(total / 1000).toFixed(1)} с`,
        `до столів ${focus - pop} мс · кадр ${frame - focus} мс · після кадру ${settled - frame} мс${
          goneStart >= pop && goneEnd ? ` · прибирання нотатки ${goneEnd - goneStart} мс` : ''
        }\n\n${perfSummary(pop - 200)}`
      );
    });
  });
}

// What was going on from `since` until now, in one line.
export function perfSummary(since: number): string {
  trim(runs);
  trim(stalls);
  trim(renders);
  trim(whys);
  const why = new Map<string, number>();
  whys.filter((w) => w.at >= since).forEach((w) => why.set(w.text, (why.get(w.text) ?? 0) + 1));
  const whyLine = Array.from(why.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t, n]) => `${t} ×${n}`)
    .join('; ');
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
    ...(whyLine ? [`чому: ${whyLine}`] : []),
  ].join('\n');
}
