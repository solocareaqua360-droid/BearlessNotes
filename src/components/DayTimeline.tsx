import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { FONT_MEDIUM, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// THE DAY AS A SCALE OF HOURS - «Сьогодні» in «Справи» v2 (the user's sketch,
// 2026-10-09): a task with a time stands on its hour, as tall as it is long,
// and a red line says where the day is now. An empty hour is a place to
// put something: tapping it asks what (TasksScreen), the way a day in a
// paper planner is filled in.

export type TimelineItem = {
  id: string;
  text: string;
  time: string; // HH:mm
  minutes?: number;
  done?: boolean;
  warn?: boolean;
  sub?: string;
};

const HOUR_H = 56;
const LABEL_W = 40;

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export default function DayTimeline({
  items,
  onPressItem,
  onPressHour,
  showNow = true,
}: {
  items: TimelineItem[];
  onPressItem: (id: string) => void;
  onPressHour: (hour: number) => void;
  showNow?: boolean;
}) {
  const theme = useTheme();
  // The red line moves on its own, a minute at a time.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // THE SCALE STARTS WHERE THE DAY IS: two hours before now and nine after
  // (at seven in the evening there is no use in eight empty morning hours
  // between you and the red line), widened to whatever the day holds.
  const starts = items.map((i) => Math.floor(toMinutes(i.time) / 60));
  const ends = items.map((i) => Math.ceil((toMinutes(i.time) + (i.minutes ?? 30)) / 60));
  const h = now.getHours();
  const first = Math.max(0, Math.min(showNow ? Math.max(6, h - 2) : 8, ...starts));
  const last = Math.min(24, Math.max(showNow ? h + 9 : 18, ...ends));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const top = (min: number) => ((min - first * 60) / 60) * HOUR_H;

  return (
    <View style={[styles.wrap, { height: hours.length * HOUR_H + 8 }]}>
      {hours.map((h) => (
        <Pressable key={h} onPress={() => onPressHour(h)} style={[styles.hour, { top: (h - first) * HOUR_H }]}>
          <Text style={[styles.label, { color: theme.ink.faint }]}>{String(h).padStart(2, '0')}</Text>
          <View style={[styles.line, { backgroundColor: theme.edge.hairline }]} />
        </Pressable>
      ))}
      {items.map((item) => {
        const start = toMinutes(item.time);
        const height = Math.max(34, ((item.minutes ?? 30) / 60) * HOUR_H - 4);
        return (
          <Pressable
            key={item.id}
            onPress={() => onPressItem(item.id)}
            style={[
              styles.block,
              {
                top: top(start) + 2,
                height,
                backgroundColor: item.warn ? '#FBF1DC' : '#E4ECFA',
                borderLeftColor: item.warn ? '#D9A441' : '#4A7BD0',
                opacity: item.done ? 0.5 : 1,
              },
            ]}
          >
            <Text style={[styles.blockText, { color: '#1F2326' }, item.done && styles.done]} numberOfLines={height > 44 ? 2 : 1}>
              {item.text}
            </Text>
            <Text style={styles.blockSub} numberOfLines={1}>
              {item.time}
              {item.sub ? ` · ${item.sub}` : ''}
            </Text>
          </Pressable>
        );
      })}
      {showNow && nowMin >= first * 60 && nowMin <= last * 60 && (
        <View pointerEvents="none" style={[styles.now, { top: top(nowMin) }]}>
          <View style={styles.nowDot} />
        </View>
      )}
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
  block: {
    position: 'absolute',
    left: LABEL_W + 4,
    right: 0,
    borderRadius: 10,
    borderLeftWidth: 3,
    paddingHorizontal: 10,
    paddingVertical: 5,
    justifyContent: 'center',
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
});
