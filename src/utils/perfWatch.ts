// WHERE THE JS THREAD GOES (2026-10-05, temporary diagnosis). Notes opened
// slower and slower through a session and fast again after a restart; the
// openings themselves were measured and trimmed, and the user said the
// plain thing: "ми лікуємо симптоми". This watches the two suspects for
// something that ACCUMULATES - live Firestore listeners (counted and timed
// at the one door, firestore.ts) and stalls of the JS thread - and the
// opening report prints what it saw around the tap.

import { useLayoutEffect, useRef } from 'react';
import { Keyboard } from 'react-native';

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
  while (kept.length > 20) kept.shift();
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
// THE TOUCHES THAT COME WHILE A NOTE IS BEING LEFT (2026-10-06): "when the
// note has closed I cannot reach the next one yet". Every touch from the
// moment the page starts to fold until the way back is reported is kept,
// with how long each waited for the JS thread - none at all in a stretch
// where the user did tap would mean the touch never arrived.
let foldStart = 0;
let foldTouches: { at: number; waited: number }[] = [];
// Everything the hand does from the start of a fold, in order, for the
// report that is written AFTER the window (the user's ignored taps come
// 0.5-1.5 s after the page has folded - later than the way-back report).
let timeline: { at: number; what: string }[] = [];
export function noteHand(what: string): void {
  if (foldStart && Date.now() - foldStart < 3000) timeline.push({ at: Date.now() - foldStart, what });
}
// The keyboard coming and going is a window resize under the whole screen:
// told to the timeline so a freeze can be laid against it.
Keyboard.addListener('keyboardDidShow', () => noteHand('клавіатура: показалась'));
Keyboard.addListener('keyboardDidHide', () => noteHand('клавіатура: сховалась'));

// THE FRAMES AFTER THE FOLD (2026-10-06): the user cannot tap the next note
// for up to a second after the page has folded, while the JS thread is free
// (no hang reported). A frame callback comes from the UI thread's own
// choreographer, so a long gap between two of them is the UI thread - the
// native views being taken down and laid out - not JS. Kept from the start
// of the fold for 2.5 s: every gap over 60 ms, with when it was.
let frameGaps: { at: number; ms: number }[] = [];
let frameLoop = 0;
export function backFoldBegin(): void {
  foldStart = Date.now();
  foldTouches = [];
  timeline = [];
  frameGaps = [];
  gcAtFold = gcStats();
  noteHand(Keyboard.isVisible() ? 'клавіатура ВІДКРИТА на початку складання' : 'клавіатура закрита на початку складання');
  const mine = ++frameLoop;
  let last = Date.now();
  const tick = () => {
    if (mine !== frameLoop) return;
    const now = Date.now();
    if (now - last > 60) frameGaps.push({ at: now - foldStart, ms: now - last });
    last = now;
    if (now - foldStart < 2500) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // Its own report, once the whole window has passed.
  setTimeout(() => {
    if (mine !== frameLoop) return;
    const hand = timeline.length
      ? timeline.map((t) => `${t.at} мс ${t.what}`).join('\n')
      : 'жодного дотику за 3 с';
    const gcNow = gcStats();
    const gcLine = gcAtFold && gcNow ? `\nзбирання сміття JS: ${gcNow.n - gcAtFold.n} разів, ${Math.round(gcNow.ms - gcAtFold.ms)} мс` : '';
    const effLine = effectsStart >= foldStart && effectsEnd ? `\nочищення ефектів редактора: ${effectsEnd - effectsStart} мс (почалось на ${effectsStart - foldStart})` : '';
    logReport('Кадри й дотики після складання', `${frameGapsLine()}${effLine}${gcLine}\nхронологія від початку складання:\n${hand}`);
  }, 3100);
}
export function frameGapsLine(): string {
  if (!frameGaps.length) return 'кадри: без пауз понад 60 мс';
  const worst = frameGaps.reduce((m, g) => Math.max(m, g.ms), 0);
  return `кадри: найдовша пауза ${worst} мс; паузи: ${frameGaps
    .slice(0, 8)
    .map((g) => `${g.ms} мс на ${g.at}`)
    .join(', ')}`;
}
let lastTouchReport = 0;
// WHO IS UNDER THE FINGER (2026-10-06): touches after a closed note reach
// the app's root but never the card. The touched element's own name and
// every element above it that carries a nativeID - the suspects are tagged
// - name what takes the touch, with its size (a whole-screen one is a
// layer lying over the list).
function describeTarget(t: any, x?: number, y?: number): string {
  if (t == null) return 'ціль невідома';
  if (typeof t === 'number') return `ціль tag ${t}`;
  const ids: string[] = [];
  try {
    let f = t.__internalInstanceHandle ?? t._internalInstanceHandle ?? null;
    let n = 0;
    while (f && n < 800) {
      const p = f.memoizedProps;
      const id = p && (p.nativeID || p.testID);
      if (id && ids[ids.length - 1] !== id) ids.push(String(id));
      f = f.return;
      n += 1;
    }
  } catch {
    // An internal shape this version does not have - the size still says a lot.
  }
  let size = '';
  try {
    const r = t.getBoundingClientRect?.();
    if (r) size = ` ${Math.round(r.width)}×${Math.round(r.height)} у ${Math.round(r.x)},${Math.round(r.y)}`;
  } catch {
    // No measure on this node.
  }
  const kind = t.nodeName ?? t.tagName ?? t.viewConfig?.uiViewClassName ?? t.__viewConfig?.uiViewClassName ?? 'в\'ю';
  const at = x !== undefined && y !== undefined ? ` · палець ${Math.round(x)},${Math.round(y)}` : '';
  return `${kind}${size}${at} · ${ids.length ? ids.slice(0, 8).join(' ← ') : 'без міток'}`;
}

export function touchArrived(nativeTimestamp: number, target?: unknown, x?: number, y?: number): void {
  if (!nativeTimestamp) return;
  const gap = Date.now() - nativeTimestamp;
  if (gap < minGap) minGap = gap;
  const waited = gap - minGap;
  if (foldStart && Date.now() - foldStart < 3000) foldTouches.push({ at: Date.now() - foldStart, waited: Math.round(waited) });
  if (foldStart && Date.now() - foldStart < 3000) noteHand(`дотик (чекав ${Math.round(waited)}) → ${describeTarget(target, x, y)}`);
  if (waited > 150 && Date.now() - lastTouchReport > 3000) {
    lastTouchReport = Date.now();
    logReport(`Дотик чекав ${waited} мс`, perfSummary(Date.now() - waited - 1500));
  }
}
// THE FINGER LIFTING to the press being handled (2026-10-06): a note's open
// is timed from morph(), which starts only when JS has been told of the
// press - anything that held the thread (or the touch system) between the
// finger lifting and that call was never in the numbers.
let lastUp = 0;
let tapLagMs = -1;
export function touchEnded(nativeTimestamp: number): void {
  lastUp = nativeTimestamp || 0;
}
export function markTapLag(): void {
  tapLagMs = lastUp && Number.isFinite(minGap) ? Math.max(0, Date.now() - lastUp - minGap) : -1;
}
export function lastTapLag(): number {
  return tapLagMs;
}
// The card's own press, from its Pressable: when the phone saw the finger
// go down and come up (the event's native time) against when JS heard each.
// Says whether a late press was a long hold, or a touch that WAITED to be
// delivered (the UI thread, not the JS one, being busy).
let downNative = 0;
let downWait = -1;
let pressInfo = '';
export function pressDown(nativeTimestamp: number): void {
  noteHand('картка: палець вниз');
  downNative = nativeTimestamp || 0;
  downWait = downNative && Number.isFinite(minGap) ? Math.max(0, Math.round(Date.now() - downNative - minGap)) : -1;
}
export function pressUp(nativeTimestamp: number): void {
  const upWait = nativeTimestamp && Number.isFinite(minGap) ? Math.max(0, Math.round(Date.now() - nativeTimestamp - minGap)) : -1;
  const held = downNative && nativeTimestamp ? Math.round(nativeTimestamp - downNative) : -1;
  pressInfo = `палець тримався ${held} мс · вниз дійшло за ${downWait} мс · вгору за ${upWait} мс`;
}
export function lastPressInfo(): string {
  return pressInfo;
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
// The editor's PASSIVE cleanups - every useEffect's return in the whole
// page, which React runs after the frame, apart from the commit that took
// the page down: unsubscribing, detaching gestures, stopping animations,
// row by row. Begun from the editor's own first effect (a deleted tree's
// effects run parent first) and ended by a timer queued then, which runs
// once the whole flush is through.
let effectsStart = 0;
let effectsEnd = 0;
export function markEditorEffectsGone(): void {
  effectsStart = Date.now();
  effectsEnd = 0;
  setTimeout(() => {
    effectsEnd = Date.now();
  }, 0);
}
// The JS engine's own collections, when the engine says (Hermes).
function gcStats(): { n: number; ms: number } | null {
  try {
    const s = (globalThis as any).HermesInternal?.getInstrumentedStats?.();
    if (!s) return null;
    return { n: Number(s.js_numGCs ?? 0), ms: Number(s.js_gcCPUTime ?? s.js_gcTime ?? 0) };
  } catch {
    return null;
  }
}
let gcAtFold: { n: number; ms: number } | null = null;
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
      if (total < 100) return;
      const fold = foldStart && foldStart <= pop ? pop - foldStart : 0;
      const touches = foldTouches.length
        ? foldTouches.map((t) => `${t.at} мс (чекав ${t.waited})`).join(', ')
        : 'жодного';
      logReport(
        `Повернення тривало ${(total / 1000).toFixed(1)} с`,
        `складання ${fold} мс · до столів ${focus - pop} мс · кадр ${frame - focus} мс · після кадру ${settled - frame} мс${
          goneStart >= pop && goneEnd ? ` · прибирання нотатки ${goneEnd - goneStart} мс` : ''
        }\nдотики від початку складання: ${touches}\n\n${perfSummary(pop - 200)}`
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
