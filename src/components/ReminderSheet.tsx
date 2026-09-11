import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  MONTH_FULL,
  WEEKDAY_SHORT,
  dateKey,
  getMonthGrid,
  parseDateKey,
} from '../utils/dateLocale';
import {
  GLASS_BACKDROP,
  GLASS_BODY,
  GLASS_DANGER,
  GLASS_LINE,
  GLASS_TEXT,
  GLASS_TEXT_FAINT,
  GLASS_TEXT_MUTED,
} from '../constants/glass';

const ACCENT = '#3B82F6';
const DANGER = GLASS_DANGER;

type Props = {
  visible: boolean;
  initialDate?: string;
  initialTime?: string;
  onClose: () => void;
  onSave: (date: string, time: string | null) => void;
  onClear: () => void;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Custom bottom-sheet date/time picker (Варіант B, chosen over the native
// Android dialog specifically to match the app's own look - see the
// reminder-picker-comparison mockup). The calendar grid reuses
// getMonthGrid, the same helper CalendarScreen's month view is built on.
export default function ReminderSheet({ visible, initialDate, initialTime, onClose, onSave, onClear }: Props) {
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selectedKey, setSelectedKey] = useState<string>(dateKey(new Date()));
  const [timeEnabled, setTimeEnabled] = useState(false);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);

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
    }
    wasVisibleRef.current = visible;
  }, [visible, initialDate, initialTime]);

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
    onSave(selectedKey, timeEnabled ? `${pad2(hour)}:${pad2(minute)}` : null);
  }

  const hasExistingReminder = Boolean(initialDate);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Нагадування</Text>

          <View style={styles.calHead}>
            <Text style={styles.calHeadTitle}>
              {MONTH_FULL[visibleMonth.month]} {visibleMonth.year}
            </Text>
            <View style={styles.calHeadArrows}>
              <Pressable hitSlop={8} onPress={() => changeMonth(-1)}>
                <Ionicons name="chevron-back" size={18} color={GLASS_TEXT_MUTED} />
              </Pressable>
              <Pressable hitSlop={8} onPress={() => changeMonth(1)}>
                <Ionicons name="chevron-forward" size={18} color={GLASS_TEXT_MUTED} />
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
            <Text style={styles.timeLabel}>Час нагадування</Text>
            <Pressable
              style={[styles.timeToggle, timeEnabled && styles.timeToggleOn]}
              onPress={() => setTimeEnabled((v) => !v)}
            >
              <Text style={[styles.timeToggleText, timeEnabled && styles.timeToggleTextOn]}>
                {timeEnabled ? `${pad2(hour)}:${pad2(minute)}` : 'Без часу'}
              </Text>
            </Pressable>
          </View>

          {timeEnabled && (
            <View style={styles.stepperRow}>
              <View style={styles.stepper}>
                <Pressable hitSlop={6} style={styles.stepperBtn} onPress={() => stepHour(-1)}>
                  <Ionicons name="remove" size={22} color={ACCENT} />
                </Pressable>
                <Text style={styles.stepperValue}>{pad2(hour)}</Text>
                <Pressable hitSlop={6} style={styles.stepperBtn} onPress={() => stepHour(1)}>
                  <Ionicons name="add" size={22} color={ACCENT} />
                </Pressable>
              </View>
              <Text style={styles.stepperColon}>:</Text>
              <View style={styles.stepper}>
                <Pressable hitSlop={6} style={styles.stepperBtn} onPress={() => stepMinute(-5)}>
                  <Ionicons name="remove" size={22} color={ACCENT} />
                </Pressable>
                <Text style={styles.stepperValue}>{pad2(minute)}</Text>
                <Pressable hitSlop={6} style={styles.stepperBtn} onPress={() => stepMinute(5)}>
                  <Ionicons name="add" size={22} color={ACCENT} />
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: GLASS_BACKDROP,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: GLASS_BODY,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: GLASS_LINE,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: GLASS_TEXT,
    marginBottom: 14,
  },
  calHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  calHeadTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: GLASS_TEXT,
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
    color: GLASS_TEXT_FAINT,
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
    backgroundColor: ACCENT,
  },
  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: ACCENT,
  },
  dayNum: {
    fontSize: 12.5,
    color: GLASS_TEXT,
  },
  dayNumMuted: {
    color: GLASS_TEXT_FAINT,
  },
  dayNumSelected: {
    color: '#fff',
    fontWeight: '700',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: GLASS_LINE,
  },
  timeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: GLASS_TEXT,
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
    backgroundColor: '#EFF6FF',
    borderColor: ACCENT,
  },
  timeToggleText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: GLASS_TEXT_MUTED,
  },
  timeToggleTextOn: {
    color: ACCENT,
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
    backgroundColor: '#EFF6FF',
  },
  stepperValue: {
    fontSize: 22,
    fontWeight: '700',
    color: GLASS_TEXT,
    fontVariant: ['tabular-nums'],
    width: 34,
    textAlign: 'center',
  },
  stepperColon: {
    fontSize: 22,
    fontWeight: '700',
    color: GLASS_TEXT,
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
    color: DANGER,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(120,120,120,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6B6558',
  },
  saveBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: ACCENT,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
