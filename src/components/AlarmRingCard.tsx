import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// The card itself, shared by the two places a ringing alarm shows it:
// AlarmRingOverlay (a Modal inside the running app) and
// AlarmRingScreenRoot (a whole separate Activity's own screen, opened
// straight over the lock screen - see plugins/withAlarmRingActivity).
// One component so the two can never end up looking like different
// features of the same alarm.
export const ACCENT = '#3B82F6';

export default function AlarmRingCard({
  text,
  onSnooze,
  onStop,
}: {
  text: string;
  onSnooze: () => void;
  onStop: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <Ionicons name="alarm" size={40} color="#fff" />
      </View>
      <Text style={styles.title}>Нагадування</Text>
      <Text style={styles.text} numberOfLines={4}>
        {text}
      </Text>
      <View style={styles.actions}>
        <Pressable style={styles.snoozeBtn} onPress={onSnooze}>
          <Text style={styles.snoozeLabel}>Відкласти на 10 хв</Text>
        </Pressable>
        <Pressable style={styles.stopBtn} onPress={onStop}>
          <Text style={styles.stopLabel}>Готово</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontFamily: FONT_BOLD,
    color: '#111827',
    marginBottom: 6,
  },
  text: {
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: '#374151',
    textAlign: 'center',
    marginBottom: 22,
  },
  actions: {
    width: '100%',
    gap: 10,
  },
  snoozeBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
  },
  snoozeLabel: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: ACCENT,
  },
  stopBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: ACCENT,
  },
  stopLabel: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
  },
});
