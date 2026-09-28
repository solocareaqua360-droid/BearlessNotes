import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  MONTH_FULL,
  WEEKDAY_SHORT,
  dateKey,
  getMonthGrid,
  parseDateKey,
} from '../utils/dateLocale';
import { GLASS_DANGER } from '../constants/glass';
import Sheet from './surfaces/Sheet';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

const DANGER = GLASS_DANGER;

type ReminderKind = 'notify' | 'alarm';

type Props = {
  visible: boolean;
  initialDate?: string;
  initialTime?: string;
  // Absent (a reminder that has never been given a kind) defaults to
  // 'alarm' - see types.ts's own note on why.
  initialKind?: ReminderKind;
  onClose: () => void;
  onSave: (date: string, time: string | null, kind: ReminderKind) => void;
  onClear: () => void;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Custom bottom-sheet date/time picker (Варіант B, chosen over the native
// Android dialog specifically to match the app's own look - see the
// reminder-picker-comparison mockup). The calendar grid reuses
// getMonthGrid, the same helper CalendarScreen's month view is built on.
export default function ReminderSheet({
  visible,
  initialDate,
  initialTime,
  initialKind,
  onClose,
  onSave,
  onClear,
}: Props) {
  const theme = useTheme();
  const accent = theme.accent;
  const styles = useStyles(makeStyles);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selectedKey, setSelectedKey] = useState<string>(dateKey(new Date()));
  const [timeEnabled, setTimeEnabled] = useState(false);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  // "для деяких справ сповіщання для деяких будильник" - the user's own
  // words for why this is a per-reminder choice, not one setting for
  // every task. Defaults to the alarm for a reminder that has never had
  // one, since that is what was asked for first ("варіант 2... повноцінний").
  const [kind, setKind] = useState<ReminderKind>('alarm');

  // Only re-seed the draft on the hidden->visible transition, never on
  // every render while open - re-seeding from props on every render is
  // exactly the bug that once wiped the sketch editor's canvas whenever
  // the keyboard opened (see DEVELOPMENT_PLAN.md history for that one).
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      const base = initialDate ? parseDateKey(initialDate) : new Date();
      setVisibleMonth({ year: base.getFullYear(), month: base.getMonth() });
      setSelectedKey(initialDate ?? dateKey(new Date()));
      setTimeEnabled(Boolean(initialTime));
      if (initialTime) {
        const [h, m] = initialTime.split(':').map(Number);
        setHour(h);
        setMinute(m);
      } else {
        setHour(9);
        setMinute(0);
      }
      setKind(initialKind ?? 'alarm');
    }
    wasVisibleRef.current = visible;
  }, [visible, initialDate, initialTime, initialKind]);

  const monthGrid = useMemo(() => getMonthGrid(visibleMonth.year, visibleMonth.month), [visibleMonth]);
  const todayKey = dateKey(new Date());

  function changeMonth(delta: number) {
    setVisibleMonth((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  // A short buzz per tap - Vibration is built into React Native core (no
  // extra native module, unlike expo-haptics), which is what makes this a
  // same-day fix rather than another rebuild-first feature.
  function stepHour(delta: number) {
    Vibration.vibrate(10);
    setHour((h) => (h + delta + 24) % 24);
  }

  function stepMinute(delta: number) {
    Vibration.vibrate(10);
    setMinute((m) => (m + delta + 60) % 60);
  }

  function handleSave() {
    onSave(selectedKey, timeEnabled ? `${pad2(hour)}:${pad2(minute)}` : null, kind);
  }

  const hasExistingReminder = Boolean(initialDate);

  return (
    // Scrolling, and capped. What is in here - a whole month grid, a
    // time, the repeat options and the buttons - is taller than a phone
    // in one go, and a sheet that outgrows the screen does not clip
    // visibly: it simply has rows that cannot be reached, which reads as
    // them not existing. The same omission the document picker had.
    <Sheet visible={visible} onClose={onClose} title="Нагадування" scroll maxHeight="80%">

          <View style={styles.calHead}>
            <Text style={styles.calHeadTitle}>
              {MONTH_FULL[visibleMonth.month]} {visibleMonth.year}
            </Text>
            <View style={styles.calHeadArrows}>
              <Pressable hitSlop={8} onPress={() => changeMonth(-1)}>
                <Ionicons name="chevron-back" size={18} color={theme.ink.muted} />
              </Pressable>
              <Pressable hitSlop={8} onPress={() => changeMonth(1)}>
                <Ionicons name="chevron-forward" size={18} color={theme.ink.muted} />
              </Pressable>
            </View>
          </View>

          <View style={styles.dow}>
            {WEEKDAY_SHORT.map((w) => (
              <Text key={w} style={styles.dowText}>
                {w}
              </Text>
            ))}
          </View>
          <View style={styles.grid}>
            {monthGrid.map(({ date, inMonth }) => {
              const key = dateKey(date);
              const isSelected = key === selectedKey;
              const isToday = key === todayKey;
              return (
                <Pressable key={key} style={styles.cell} onPress={() => setSelectedKey(key)}>
                  <View
                    style={[
                      styles.dayCircle,
                      isSelected && styles.dayCircleSelected,
                      isToday && !isSelected && styles.dayCircleToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayNum,
                        !inMonth && styles.dayNumMuted,
                        isSelected && styles.dayNumSelected,
                      ]}
                    >
                      {date.getDate()}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.timeRow}>
            {/* A date with no time is only a badge on the task -
                nothing schedules, alarm or notification, until a time
                is set. The kind (below) is what that time actually
                does. */}
            <Text style={styles.timeLabel}>Час</Text>
            <Pressable
              style={[styles.timeToggle, timeEnabled && styles.timeToggleOn]}
              onPress={() => setTimeEnabled((v) => !v)}
            >
              <Text style={[styles.timeToggleText, timeEnabled && styles.timeToggleTextOn]}>
                {timeEnabled ? `${pad2(hour)}:${pad2(minute)}` : 'Вимкнено'}
              </Text>
            </Pressable>
          </View>

          {timeEnabled && (
            <>
              {/* "для деяких справ сповіщання для деяких будильник" -
                  the choice itself. A tab, not a checkbox: the two are
                  alternatives, never both at once. */}
              <View style={styles.kindRow}>
                <Pressable
                  style={[styles.kindTab, kind === 'notify' && styles.kindTabActive]}
                  onPress={() => setKind('notify')}
                >
                  <Ionicons
                    name="notifications-outline"
                    size={15}
                    color={kind === 'notify' ? accent : theme.ink.muted}
                  />
                  <Text style={[styles.kindTabLabel, kind === 'notify' && styles.kindTabLabelActive]}>
                    Сповіщення
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.kindTab, kind === 'alarm' && styles.kindTabActive]}
                  onPress={() => setKind('alarm')}
                >
                  <Ionicons name="alarm-outline" size={15} color={kind === 'alarm' ? accent : theme.ink.muted} />
                  <Text style={[styles.kindTabLabel, kind === 'alarm' && styles.kindTabLabelActive]}>
                    Будильник
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.timeHint}>
                {kind === 'alarm'
                  ? 'Задзвонить у вказаний час, навіть на беззвучному'
                  : 'Один тихий сигнал о вказаний час'}
              </Text>
            </>
          )}

          {timeEnabled && (
            <View style={styles.stepperRow}>
              <View style={styles.stepper}>
                <Pressable hitSlop={6} style={styles.stepperBtn} onPress={() => stepHour(-1)}>
                  <Ionicons name="remove" size={22} color={accent} />
                </Pressable>
                <Text style={styles.stepperValue}>{pad2(hour)}</Text>
                <Pressable hitSlop={6} style={styles.stepperBtn} onPress={() => stepHour(1)}>
                  <Ionicons name="add" size={22} color={accent} />
                </Pressable>
              </View>
              <Text style={styles.stepperColon}>:</Text>
              <View style={styles.stepper}>
                <Pressable hitSlop={6} style={styles.stepperBtn} onPress={() => stepMinute(-5)}>
                  <Ionicons name="remove" size={22} color={accent} />
                </Pressable>
                <Text style={styles.stepperValue}>{pad2(minute)}</Text>
                <Pressable hitSlop={6} style={styles.stepperBtn} onPress={() => stepMinute(5)}>
                  <Ionicons name="add" size={22} color={accent} />
                </Pressable>
              </View>
            </View>
          )}

          <View style={styles.actions}>
            {hasExistingReminder && (
              <Pressable style={styles.clearBtn} onPress={onClear}>
                <Text style={styles.clearBtnText}>Прибрати</Text>
              </Pressable>
            )}
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Скасувати</Text>
            </Pressable>
            <Pressable style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>Зберегти</Text>
            </Pressable>
          </View>
    </Sheet>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  calHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  calHeadTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
  },
  calHeadArrows: {
    flexDirection: 'row',
    gap: 16,
  },
  dow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  dowText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10.5,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.faint,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  cell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: 2,
  },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleSelected: {
    backgroundColor: t.accent,
  },
  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: t.accent,
  },
  dayNum: {
    fontSize: 12.5,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  dayNumMuted: {
    color: t.ink.faint,
  },
  // On the accent, so it takes the theme's answer for what reads on it -
  // white was right while the accent was always dark, and invisible the
  // moment a theme's accent turned near-white (the black one's is
  // #E5E7EB).
  dayNumSelected: {
    color: t.onAccent,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: t.edge.hairline,
  },
  timeLabel: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  timeHint: {
    fontSize: 11.5,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
    marginTop: -2,
    marginBottom: 6,
  },
  kindRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 10,
    paddingBottom: 6,
  },
  kindTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(120,120,120,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  kindTabActive: {
    backgroundColor: t.selected,
    borderColor: t.accent,
  },
  kindTabLabel: {
    fontSize: 12.5,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.muted,
  },
  kindTabLabelActive: {
    color: t.accent,
  },
  timeToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(120,120,120,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  timeToggleOn: {
    backgroundColor: t.selected,
    borderColor: t.accent,
  },
  timeToggleText: {
    fontSize: 12.5,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.ink.muted,
  },
  timeToggleTextOn: {
    color: t.accent,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 10,
  },
  // Buttons sit to the LEFT and RIGHT of the number, not stacked above/
  // below it - a thumb tapping either one never covers the digits it's
  // supposed to be changing.
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.selected,
  },
  stepperValue: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
    fontVariant: ['tabular-nums'],
    width: 34,
    textAlign: 'center',
  },
  stepperColon: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  clearBtn: {
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  clearBtnText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: DANGER,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: t.field.fill,
    borderWidth: 1,
    borderColor: t.edge.hairline,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.ink.muted,
  },
  saveBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: t.accent,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.onAccent,
  },
});
