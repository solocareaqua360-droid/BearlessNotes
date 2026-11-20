import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Sheet from './surfaces/Sheet';
import { Ionicons } from './icons/Ionicons';
import AttachmentImage from './AttachmentImage';
import { useTheme } from '../theme/ThemeProvider';
import { hapticPickUp, hapticSelectItem } from '../utils/haptics';
import type { BoardPlan, PlanItem } from '../utils/deletionPlan';

// «ЩО ЛИШИТИ?» - the window a deleted board (later a note, a folder, a
// project) opens before it goes (the user, 2026-10-09). Its contents are
// records of their own in the bases, so each one is asked about:
//   - grouped by KIND, one header per kind with one checkbox for all of
//     them (a dash when only some are ticked), items folded away under
//     it when there are many;
//   - everything starts as KEPT - a tick means "delete this one too";
//   - the iPhone way of ticking a lot at once: hold on a row, then move
//     the finger up or down - every row it passes takes the tick (or
//     loses it, if the row you started on was ticked). The list scrolls
//     itself when the finger rests near its edge.
// What is only on the board (stickies, free text) is not listed - one
// quiet line says it goes with it.

const HEAD_H = 52;
const ITEM_H = 64;
const FOLD_OVER = 6;
const EDGE = 56;

type Row = { key: string; top: number; height: number; kind: 'head' | 'item'; group: number; itemKey?: string };

export default function DeleteContentsSheet({
  visible,
  title,
  subtitle,
  noun,
  plan,
  note,
  place = 'цій дошці',
  withIt = 'нею',
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  // «дошку» / «нотатку» - for the red button
  noun: string;
  plan: BoardPlan;
  // A line of its own under the hints - what else happens (nested notes, the bin's 30 days).
  note?: string;
  // «цій дошці» / «цій нотатці» / «цих дошках» - where the own-only things lie.
  place?: string;
  // How «разом з …» reads: «нею» for one board, «ними» for several.
  withIt?: string;
  onCancel: () => void;
  onConfirm: (chosen: PlanItem[]) => void;
}) {
  const theme = useTheme();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [folded, setFolded] = useState<Set<number>>(new Set());

  // A fresh window every time: nothing ticked, big groups folded.
  useEffect(() => {
    if (!visible) return;
    setTicked(new Set());
    setFolded(new Set(plan.groups.map((g, i) => (g.items.length > FOLD_OVER ? i : -1)).filter((i) => i >= 0)));
  }, [visible, plan]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    let top = 0;
    plan.groups.forEach((g, gi) => {
      out.push({ key: `h${gi}`, top, height: HEAD_H, kind: 'head', group: gi });
      top += HEAD_H;
      if (!folded.has(gi)) {
        g.items.forEach((it) => {
          out.push({ key: it.key, top, height: ITEM_H, kind: 'item', group: gi, itemKey: it.key });
          top += ITEM_H;
        });
      }
    });
    return out;
  }, [plan, folded]);
  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const totalH = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height : 0;

  const allItems = useMemo(() => plan.groups.flatMap((g) => g.items), [plan]);
  const chosen = allItems.filter((i) => ticked.has(i.key));

  function toggleItem(key: string) {
    hapticSelectItem();
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleGroup(gi: number) {
    hapticSelectItem();
    const keys = plan.groups[gi].items.map((i) => i.key);
    setTicked((prev) => {
      const next = new Set(prev);
      // Anything ticked in it - a few or all - the tap CLEARS first (the
      // dash on the box says so); only an untouched group is ticked whole.
      const any = keys.some((k) => next.has(k));
      keys.forEach((k) => (any ? next.delete(k) : next.add(k)));
      return next;
    });
  }
  function toggleFold(gi: number) {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(gi)) next.delete(gi);
      else next.add(gi);
      return next;
    });
  }

  // ---- hold and move -------------------------------------------------
  // Everything the gesture reads lives in refs: the callbacks are built
  // once per render, but a drag outlives several renders.
  const scrollRef = useRef<ScrollView>(null);
  const boxRef = useRef<View>(null);
  const boxTop = useRef(0);
  const boxH = useRef(0);
  const scrollY = useRef(0);
  const live = useRef({ rows, plan, ticked });
  live.current = { rows, plan, ticked };
  const drag = useRef<{ from: number; last: number; mode: 'add' | 'remove'; base: Set<string>; absY: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function rowAt(absY: number): number {
    const y = absY - boxTop.current + scrollY.current;
    const list = live.current.rows;
    for (let i = 0; i < list.length; i += 1) if (y < list[i].top + list[i].height) return i;
    return list.length - 1;
  }
  function keysOf(row: Row): string[] {
    if (row.kind === 'item') return [row.itemKey!];
    return live.current.plan.groups[row.group].items.map((i) => i.key);
  }
  function apply(absY: number) {
    const d = drag.current;
    if (!d) return;
    d.absY = absY;
    const list = live.current.rows;
    const to = rowAt(absY);
    // One tick for every row the finger comes onto, as on the iPhone.
    if (to !== d.last) {
      d.last = to;
      hapticSelectItem();
    }
    const [a, b] = d.from <= to ? [d.from, to] : [to, d.from];
    const next = new Set(d.base);
    for (let i = a; i <= b; i += 1) {
      keysOf(list[i]).forEach((k) => (d.mode === 'add' ? next.add(k) : next.delete(k)));
    }
    setTicked(next);
  }
  function stopTimer() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }
  function startTimer() {
    if (timer.current) return;
    timer.current = setInterval(() => {
      const d = drag.current;
      if (!d) return stopTimer();
      const rel = d.absY - boxTop.current;
      let step = 0;
      if (rel < EDGE) step = -Math.ceil((EDGE - rel) / 5);
      else if (rel > boxH.current - EDGE) step = Math.ceil((rel - (boxH.current - EDGE)) / 5);
      if (!step) return;
      const max = Math.max(0, totalH - boxH.current);
      const y = Math.max(0, Math.min(max, scrollY.current + step));
      if (y === scrollY.current) return;
      scrollY.current = y;
      scrollRef.current?.scrollTo({ y, animated: false });
      apply(d.absY);
    }, 16);
  }
  useEffect(() => stopTimer, []);

  function measureBox(then: () => void) {
    boxRef.current?.measureInWindow((_x, y, _w, h) => {
      boxTop.current = y;
      boxH.current = h;
      then();
    });
  }

  const hold = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(320)
    .onStart((e) => {
      const absY = e.absoluteY;
      measureBox(() => {
        const from = rowAt(absY);
        const row = live.current.rows[from];
        if (!row) return;
        const keys = keysOf(row);
        const on = keys.length > 0 && keys.every((k) => live.current.ticked.has(k));
        drag.current = { from, last: from, mode: on ? 'remove' : 'add', base: new Set(live.current.ticked), absY };
        hapticPickUp();
        apply(absY);
        startTimer();
      });
    })
    .onUpdate((e) => {
      if (drag.current) apply(e.absoluteY);
    })
    .onFinalize(() => {
      drag.current = null;
      stopTimer();
    });

  const count = chosen.length;
  const sharedChosen = chosen.filter((i) => i.shared).length;

  return (
    <Sheet visible={visible} onClose={onCancel} title={title} subtitle={subtitle}>
      <Text style={[styles.lead, { color: theme.ink.muted }]}>
        {`Лежить у базах окремо: ${allItems.length}. Позначене галочкою піде в кошик разом з ${withIt}, решта лишиться там, де була.`}
      </Text>
      <View
        ref={boxRef}
        collapsable={false}
        style={styles.box}
        onLayout={() => measureBox(() => {})}
      >
        <GestureDetector gesture={hold}>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            scrollEventThrottle={16}
            onScroll={(e) => {
              scrollY.current = e.nativeEvent.contentOffset.y;
            }}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ height: totalH }}>
              {plan.groups.map((g, gi) => {
                const on = g.items.filter((i) => ticked.has(i.key)).length;
                const state = on === 0 ? 'none' : on === g.items.length ? 'all' : 'some';
                const head = rowByKey.get(`h${gi}`)!;
                return (
                  <View key={g.kind}>
                    <View style={[styles.head, { top: head.top, backgroundColor: theme.surface }]}>
                      <Pressable style={styles.headMain} onPress={() => toggleGroup(gi)}>
                        <Box state={state} />
                        <Text style={[styles.headLabel, { color: theme.ink.primary }]}>{g.label}</Text>
                        <Text style={[styles.headCount, { color: theme.ink.faint }]}>
                          {on > 0 ? `${on} з ${g.items.length}` : g.items.length}
                        </Text>
                      </Pressable>
                      <Pressable style={styles.chevron} hitSlop={6} onPress={() => toggleFold(gi)}>
                        <Ionicons name={folded.has(gi) ? 'chevron-down' : 'chevron-up'} size={18} color={theme.ink.faint} />
                      </Pressable>
                    </View>
                    {!folded.has(gi) &&
                      g.items.map((it) => {
                        const r = rowByKey.get(it.key)!;
                        return (
                          <Pressable key={it.key} style={[styles.item, { top: r.top }]} onPress={() => toggleItem(it.key)}>
                            <Box state={ticked.has(it.key) ? 'all' : 'none'} small />
                            <View style={[styles.tile, { backgroundColor: theme.raised }]}>
                              {it.thumb ? (
                                /^https?:/.test(it.thumb.uri) ? (
                                  <Image source={{ uri: it.thumb.uri }} style={styles.thumb} resizeMode="cover" />
                                ) : (
                                  <AttachmentImage uri={it.thumb.uri} driveFileId={it.thumb.driveFileId} style={styles.thumb} />
                                )
                              ) : (
                                <Ionicons name={it.icon as never} size={22} color={theme.ink.faint} />
                              )}
                            </View>
                            <View style={styles.itemBody}>
                              <Text style={[styles.itemText, { color: theme.ink.primary }]} numberOfLines={1}>
                                {it.title}
                              </Text>
                              {!!it.subtitle && (
                                <Text style={[styles.itemSub, { color: theme.ink.faint }]} numberOfLines={1}>
                                  {it.subtitle}
                                </Text>
                              )}
                            </View>
                            {it.shared && <Text style={[styles.shared, { color: theme.ink.faint }]}>є ще десь</Text>}
                            
                          </Pressable>
                        );
                      })}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </GestureDetector>
      </View>
      <Text style={[styles.hint, { color: theme.ink.faint }]}>
        Затисни рядок і веди пальцем вгору чи вниз — позначиш одразу кілька.
      </Text>
      {plan.ownCount > 0 && (
        <Text style={[styles.hint, { color: theme.ink.faint }]}>
          {`Те, що є лише в ${place} (${plan.ownCount}), зникне разом з ${withIt}.`}
        </Text>
      )}
      {!!note && <Text style={[styles.hint, { color: theme.ink.faint }]}>{note}</Text>}
      {sharedChosen > 0 && (
        <Text style={[styles.hint, { color: theme.danger }]}>
          {`Серед позначених ${sharedChosen} ще десь використовуються — там вони зникнуть теж.`}
        </Text>
      )}
      <View style={styles.buttons}>
        <Pressable onPress={onCancel} style={[styles.button, { borderColor: theme.edge.hairline, borderWidth: 1.5 }]}>
          <Text style={[styles.buttonText, { color: theme.ink.primary }]}>Скасувати</Text>
        </Pressable>
        <Pressable onPress={() => onConfirm(chosen)} style={[styles.button, { backgroundColor: theme.danger }]}>
          <Text style={[styles.buttonText, { color: '#fff' }]} numberOfLines={1}>
            {count > 0 ? `Видалити ${noun} і ${count}` : `Видалити лише ${noun}`}
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

function Box({ state, small }: { state: 'none' | 'some' | 'all'; small?: boolean }) {
  const theme = useTheme();
  const size = small ? 20 : 24;
  const filled = state !== 'none';
  return (
    <View
      style={[
        styles.box2,
        { width: size, height: size, borderColor: filled ? theme.danger : theme.ink.faint },
        filled && { backgroundColor: theme.danger },
      ]}
    >
      {state === 'all' && <Ionicons name="checkmark" size={small ? 14 : 16} color="#fff" />}
      {state === 'some' && <Ionicons name="remove" size={small ? 14 : 16} color="#fff" />}
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  box: { maxHeight: 400, overflow: 'hidden', borderRadius: 14 },
  scroll: { maxHeight: 400 },
  head: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: HEAD_H,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  headMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, height: HEAD_H },
  headLabel: { fontSize: 16, fontWeight: '700' },
  headCount: { fontSize: 13, marginLeft: 'auto' },
  chevron: { width: 36, height: HEAD_H, alignItems: 'center', justifyContent: 'center' },
  item: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ITEM_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 24,
    paddingRight: 12,
  },
  tile: { width: 48, height: 48, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 48, height: 48 },
  itemBody: { flex: 1 },
  itemText: { fontSize: 15 },
  itemSub: { fontSize: 12, marginTop: 1 },
  shared: { fontSize: 11 },
  box2: { borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 14 },
  button: { flex: 1, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  buttonText: { fontSize: 14, fontWeight: '600' },
});
