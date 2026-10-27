import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { Ionicons } from './icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';
import { FONT_MEDIUM, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { hapticSnapTick } from '../utils/haptics';

// THE DAY AS A SCALE OF HOURS - «Сьогодні» in «Справи» v2 (the user's sketch,
// 2026-10-09): a task with a time stands on its hour, as tall as it is long,
// and a red line says where the day is now. An empty hour is a place to
// put something: tapping it asks what (TasksScreen), the way a day in a
// paper planner is filled in.
//
// 2026-10-27 (sketch reports/sketch-timeline-background-task.html, variant A, agreed 26.10):
//  - a BACKGROUND task (accepting road sheets 08-14, done any time in its window) is a pale warm band with a frame under
//    everything; the tasks of its window stand on top of it, stepped in from the left so the band shows. Its steps with an
//    hour of their own are warmer blocks inside the band; the rest are only the «✓ 2 з 5» in its head, and a tap there
//    opens them as a small list to tick and untick;
//  - a task with a start only is a narrow strip «назва · 12:00», not a made-up half hour; with an end it is a block as
//    long as it is, «12:00–13:00»;
//  - tasks over the same time stand side by side - nothing moves by itself when one grows (Google's and Apple's way);
//  - the bottom edge of a block is pulled by a finger to make it longer or shorter, in steps of a quarter of an hour.

export type TimelineSub = { id: string; text: string; checked: boolean; time?: string };
export type TimelineItem = {
  id: string;
  text: string;
  time: string; // HH:mm
  minutes?: number;
  done?: boolean;
  warn?: boolean;
  sub?: string;
  background?: boolean;
  subs?: TimelineSub[];
};

const HOUR_H = 56;
const LABEL_W = 40;
const STRIP_H = 26;
const BAND_INSET = 18;
const STEP = 15;

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Side by side: each task in the first column free at its start, the columns counted per group of tasks that touch.
function columns(list: { id: string; start: number; end: number }[]) {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = new Map<string, { col: number; cols: number }>();
  let group: { id: string; col: number }[] = [];
  let colEnds: number[] = [];
  let groupEnd = -1;
  const close = () => {
    group.forEach((g) => out.set(g.id, { col: g.col, cols: colEnds.length }));
    group = [];
    colEnds = [];
  };
  sorted.forEach((it) => {
    if (it.start >= groupEnd) close();
    let col = colEnds.findIndex((e) => e <= it.start);
    if (col < 0) {
      col = colEnds.length;
      colEnds.push(it.end);
    } else colEnds[col] = it.end;
    group.push({ id: it.id, col });
    groupEnd = Math.max(groupEnd, it.end);
  });
  close();
  return out;
}

export default function DayTimeline({
  items,
  onPressItem,
  onPressHour,
  onResize,
  onToggleSub,
  onSubTime,
  showNow = true,
}: {
  items: TimelineItem[];
  onPressItem: (id: string) => void;
  onPressHour: (hour: number) => void;
  // A block's length pulled by the finger, in minutes (a multiple of 15).
  onResize?: (id: string, minutes: number) => void;
  // A step of a background task ticked or unticked in its little list.
  onToggleSub?: (id: string, subId: string) => void;
  // The hour of a step asked for (its own time, to stand inside the band).
  onSubTime?: (id: string, subId: string) => void;
  showNow?: boolean;
}) {
  const theme = useTheme();
  // The red line moves on its own, a minute at a time.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [width, setWidth] = useState(0);
  // The block being pulled longer or shorter: what it measures right now.
  const [live, setLive] = useState<{ id: string; minutes: number } | null>(null);
  // The background task whose steps are open as a list.
  const [subsFor, setSubsFor] = useState<string | null>(null);

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const lengthOf = (i: TimelineItem) => (live?.id === i.id ? live.minutes : i.minutes);
  // THE SCALE STARTS WHERE THE DAY IS: two hours before now and nine after
  // (at seven in the evening there is no use in eight empty morning hours
  // between you and the red line), widened to whatever the day holds.
  const starts = items.map((i) => Math.floor(toMinutes(i.time) / 60));
  const ends = items.map((i) => Math.ceil((toMinutes(i.time) + (lengthOf(i) ?? 30)) / 60));
  const h = now.getHours();
  const first = Math.max(0, Math.min(showNow ? Math.max(6, h - 2) : 8, ...starts));
  const last = Math.min(24, Math.max(showNow ? h + 9 : 18, ...ends));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const top = (min: number) => ((min - first * 60) / 60) * HOUR_H;
  const px = (minutes: number) => (minutes / 60) * HOUR_H;

  const bands = items.filter((i) => i.background);
  const fore = items.filter((i) => !i.background);
  // How tall a foreground task stands: its length, or a strip when it has none.
  const spanOf = (i: TimelineItem) => {
    const m = lengthOf(i);
    return m ? Math.max(STRIP_H, px(m) - 4) : STRIP_H;
  };
  const cols = useMemo(
    () => columns(fore.map((i) => ({ id: i.id, start: toMinutes(i.time), end: toMinutes(i.time) + Math.max(15, ((spanOf(i) + 4) / HOUR_H) * 60) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, live]
  );
  const inBand = (i: TimelineItem) => {
    const s = toMinutes(i.time);
    return bands.some((b) => {
      const bs = toMinutes(b.time);
      return s >= bs && s < bs + (lengthOf(b) ?? 120);
    });
  };

  // THE PULL: the finger's travel turned into minutes, in quarter-hour steps; written once it lets go.
  const base = useRef(0);
  const lastStep = useRef(0);
  const begin = (id: string, minutes: number) => {
    base.current = minutes;
    lastStep.current = minutes;
    setLive({ id, minutes });
  };
  const pull = (id: string, dy: number) => {
    const m = Math.max(STEP, Math.round((base.current + (dy / HOUR_H) * 60) / STEP) * STEP);
    if (m !== lastStep.current) {
      lastStep.current = m;
      hapticSnapTick();
      setLive({ id, minutes: m });
    }
  };
  const end = (id: string) => {
    const m = lastStep.current;
    setLive(null);
    if (m !== base.current) onResize?.(id, m);
  };
  const grip = (item: TimelineItem) => {
    if (!onResize || item.done) return null;
    const g = Gesture.Pan()
      .activeOffsetY([-3, 3])
      .onStart(() => runOnJS(begin)(item.id, item.minutes ?? 0))
      .onUpdate((e) => runOnJS(pull)(item.id, e.translationY))
      .onEnd(() => runOnJS(end)(item.id));
    return (
      <GestureDetector gesture={g}>
        <View style={styles.grip} accessibilityLabel="Потягнути, щоб змінити тривалість">
          <View style={[styles.gripBar, { backgroundColor: 'rgba(31,35,38,0.28)' }]} />
        </View>
      </GestureDetector>
    );
  };

  const label = (i: TimelineItem) => {
    const m = lengthOf(i);
    const s = toMinutes(i.time);
    return m ? `${hhmm(s)}–${hhmm(s + m)}` : i.time;
  };

  return (
    <View style={[styles.wrap, { height: hours.length * HOUR_H + 8 }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {hours.map((hr) => (
        <Pressable key={hr} onPress={() => onPressHour(hr)} style={[styles.hour, { top: (hr - first) * HOUR_H }]}>
          <Text style={[styles.label, { color: theme.ink.faint }]}>{String(hr).padStart(2, '0')}</Text>
          <View style={[styles.line, { backgroundColor: theme.edge.hairline }]} />
        </Pressable>
      ))}

      {bands.map((item) => {
        const start = toMinutes(item.time);
        const minutes = lengthOf(item) ?? 120;
        const subs = item.subs ?? [];
        const done = subs.filter((s) => s.checked).length;
        const timedSubs = subs.filter((s) => s.time);
        return (
          <View key={item.id} style={[styles.band, { top: top(start) + 2, height: Math.max(48, px(minutes) - 4), opacity: item.done ? 0.5 : 1 }]}>
            <Pressable onPress={() => onPressItem(item.id)} style={styles.bandHead}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.blockText, { color: '#5A3B12' }, item.done && styles.done]} numberOfLines={1}>
                  {item.text}
                </Text>
                <Text style={[styles.blockSub, { color: '#8A6A3E' }]} numberOfLines={1}>
                  {`фонова · ${label(item)}`}
                </Text>
              </View>
              {subs.length > 0 && (
                <Pressable onPress={() => setSubsFor(subsFor === item.id ? null : item.id)} style={styles.subsChip} hitSlop={6}>
                  <Ionicons name="checkmark" size={13} color="#8A6A3E" />
                  <Text style={styles.subsChipText}>{`${done} з ${subs.length}`}</Text>
                </Pressable>
              )}
            </Pressable>
            {timedSubs.map((s) => {
              const at = toMinutes(s.time!) - start;
              if (at < 0 || at >= minutes) return null;
              return (
                <View key={s.id} style={[styles.subBlock, { top: px(at) }, s.checked && { opacity: 0.5 }]}>
                  <Text style={[styles.subText, s.checked && styles.done]} numberOfLines={1}>{`↳ ${s.text} · ${s.time}`}</Text>
                </View>
              );
            })}
            {grip(item)}
          </View>
        );
      })}

      {fore.map((item) => {
        const start = toMinutes(item.time);
        const height = spanOf(item);
        const strip = !lengthOf(item);
        const c = cols.get(item.id) ?? { col: 0, cols: 1 };
        const left0 = LABEL_W + 4 + (inBand(item) ? BAND_INSET : 0);
        const avail = Math.max(0, width - left0);
        const w = width ? avail / c.cols : undefined;
        return (
          <Pressable
            key={item.id}
            onPress={() => onPressItem(item.id)}
            style={[
              styles.block,
              {
                top: top(start) + 2,
                height,
                left: left0 + (w ? c.col * w : 0),
                ...(w ? { width: w - (c.cols > 1 ? 3 : 0) } : { right: 0 }),
                backgroundColor: item.warn ? '#FBF1DC' : '#E4ECFA',
                // A frame all round, not a bar down the left edge (the user's standing rule, applied here 2026-10-26).
                borderColor: item.warn ? 'rgba(217,164,65,0.55)' : 'rgba(74,123,208,0.45)',
                opacity: item.done ? 0.5 : 1,
                paddingVertical: strip ? 0 : 5,
              },
            ]}
          >
            {strip ? (
              <Text style={[styles.blockText, { color: '#1F2326', fontSize: 13 }, item.done && styles.done]} numberOfLines={1}>
                {item.text}
                <Text style={styles.blockSub}>{`  ${item.time}`}</Text>
              </Text>
            ) : (
              <>
                <Text style={[styles.blockText, { color: '#1F2326' }, item.done && styles.done]} numberOfLines={height > 44 ? 2 : 1}>
                  {item.text}
                </Text>
                <Text style={styles.blockSub} numberOfLines={1}>
                  {label(item)}
                  {item.sub ? ` · ${item.sub}` : ''}
                </Text>
              </>
            )}
            {grip(item)}
          </Pressable>
        );
      })}

      {showNow && nowMin >= first * 60 && nowMin <= last * 60 && (
        <View pointerEvents="none" style={[styles.now, { top: top(nowMin) }]}>
          <View style={styles.nowDot} />
        </View>
      )}

      {/* The steps of a background task, under its head - inside the scale, so Android still hands it the taps. */}
      {subsFor !== null &&
        (() => {
          const item = bands.find((b) => b.id === subsFor);
          if (!item) return null;
          return (
            <View style={[styles.subsPop, { top: Math.max(0, Math.min(top(toMinutes(item.time)) + 50, hours.length * HOUR_H - 12 - 40 * (item.subs?.length ?? 0))) }]}>
              {(item.subs ?? []).map((s) => (
                <View key={s.id} style={styles.subRow}>
                  <Pressable onPress={() => onToggleSub?.(item.id, s.id)} hitSlop={6} style={styles.subTap} accessibilityLabel={s.checked ? 'Зняти позначку' : 'Позначити зробленим'}>
                    <Ionicons name={s.checked ? 'checkbox' : 'square-outline'} size={20} color={s.checked ? '#B07A44' : '#8A8F94'} />
                    <Text style={[styles.subRowText, s.checked && styles.done]} numberOfLines={2}>
                      {s.text}
                    </Text>
                  </Pressable>
                  {onSubTime && (
                    <Pressable onPress={() => onSubTime(item.id, s.id)} hitSlop={6} style={styles.subTime}>
                      <Text style={styles.subTimeText}>{s.time ?? 'час'}</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          );
        })()}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    marginTop: 4,
  },
  hour: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: HOUR_H,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  label: {
    width: LABEL_W,
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    marginTop: -8,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  band: {
    position: 'absolute',
    left: LABEL_W + 4,
    right: 0,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(217,164,65,0.45)',
    backgroundColor: '#FBF3E4',
    overflow: 'hidden',
  },
  bandHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4 },
  subsChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, height: 24, borderRadius: 12, backgroundColor: 'rgba(217,164,65,0.18)' },
  subsChipText: { fontSize: 12, fontFamily: FONT_MEDIUM, color: '#8A6A3E' },
  subBlock: {
    position: 'absolute',
    left: BAND_INSET,
    right: 10,
    height: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(217,164,65,0.6)',
    backgroundColor: '#F6E2BC',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  subText: { fontSize: 12, fontFamily: FONT_MEDIUM, color: '#5A3B12' },
  block: {
    position: 'absolute',
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  blockText: {
    fontSize: 14,
    fontFamily: FONT_SEMIBOLD,
  },
  done: {
    textDecorationLine: 'line-through',
  },
  blockSub: {
    fontSize: 11.5,
    fontFamily: FONT_MEDIUM,
    color: '#6A7075',
  },
  grip: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 14, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 3 },
  gripBar: { width: 26, height: 3, borderRadius: 2 },
  now: {
    position: 'absolute',
    left: LABEL_W - 4,
    right: 0,
    height: 2,
    backgroundColor: '#D5564B',
  },
  nowDot: {
    position: 'absolute',
    left: -4,
    top: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#D5564B',
  },
  subsPop: {
    position: 'absolute',
    right: 8,
    width: 250,
    borderRadius: 14,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(31,35,38,0.12)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
    zIndex: 50,
  } as never,
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 40 },
  subTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  subRowText: { flex: 1, fontSize: 14, fontFamily: FONT_REGULAR, color: '#1F2326' },
  subTime: { paddingHorizontal: 8, height: 26, borderRadius: 13, backgroundColor: 'rgba(31,35,38,0.06)', justifyContent: 'center' },
  subTimeText: { fontSize: 12, fontFamily: FONT_MEDIUM, color: '#5F656B' },
});
