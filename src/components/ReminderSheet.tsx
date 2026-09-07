import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  MONTH_FULL,
  WEEKDAY_SHORT,
  dateKey,
  getMonthGrid,
  parseDateKey,
} from '../utils/dateLocale';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';

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

  function stepHour(delta: number) {
    setHour((h) => (h + delta + 24) % 24);
  }

  function stepMinute(delta: number) {
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
                <Ionicons name="chevron-back" size={18} color="#6B7280" />
              </Pressable>
              <Pressable hitSlop={8} onPress={() => changeMonth(1)}>
                <Ionicons name="chevron-forward" size={18} color="#6B7280" />
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
                <Pressable hitSlop={8} onPress={() => stepHour(1)}>
                  <Ionicons name="chevron-up" size={18} color={ACCENT} />
                </Pressable>
                <Text style={styles.stepperValue}>{pad2(hour)}</Text>
                <Pressable hitSlop={8} onPress={() => stepHour(-1)}>
                  <Ionicons name="chevron-down" size={18} color={ACCENT} />
                </Pressable>
              </View>
              <Text style={styles.stepperColon}>:</Text>
              <View style={styles.stepper}>
                <Pressable hitSlop={8} onPress={() => stepMinute(5)}>
                  <Ionicons name="chevron-up" size={18} color={ACCENT} />
                </Pressable>
                <Text style={styles.stepperValue}>{pad2(minute)}</Text>
                <Pressable hitSlop={8} onPress={() => stepMinute(-5)}>
                  <Ionicons name="chevron-down" size={18} color={ACCENT} />
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
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
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
    color: '#111827',
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
    color: '#9CA3AF',
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
    color: '#111827',
  },
  dayNumMuted: {
    color: '#D1D5DB',
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
    borderTopColor: '#F3F4F6',
  },
  timeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
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
    color: '#6B7280',
  },
  timeToggleTextOn: {
    color: ACCENT,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  stepper: {
    alignItems: 'center',
    gap: 2,
  },
  stepperValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    fontVariant: ['tabular-nums'],
    paddingVertical: 2,
  },
  stepperColon: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
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
