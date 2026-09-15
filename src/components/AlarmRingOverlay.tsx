import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import notifee, { EventType } from '@notifee/react-native';
import { dismissReminder, reminderTextOf, snoozeReminder } from '../utils/reminders';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// The in-app half of a ringing alarm.
//
// notifee's fullScreenAction brings the app forward, and its tray
// notification keeps ringing regardless - but arriving in the app to
// find nothing on screen about WHY, with a sound looping somewhere
// behind it, is worse than no alarm at all. This is what stands in
// front of the app the moment that happens: the task's own text, and
// the same two actions the tray offers, big enough to hit without
// reading first.
//
// A Modal, not a layer drawn inside the navigator - the same reason
// AskHost is one: nothing else in the app should be able to end up on
// top of an alarm that is actively ringing.
export default function AlarmRingOverlay() {
  const [ringing, setRinging] = useState<{ id: string | undefined; text: string } | null>(null);

  useEffect(() => {
    // The app was launched BY tapping the alarm (it was not already
    // running) - the one case onForegroundEvent below never sees, since
    // it only fires for events after the JS runtime is already up.
    notifee.getInitialNotification().then((initial) => {
      if (initial?.notification?.data?.kind === 'task-alarm') {
        setRinging({ id: initial.notification.id, text: reminderTextOf(initial.notification) });
      }
    });
    // The app was already open (foreground or backgrounded-but-alive)
    // when the alarm fired or was tapped.
    return notifee.onForegroundEvent((event) => {
      const notification = event.detail.notification;
      if (notification?.data?.kind !== 'task-alarm') return;
      if (event.type === EventType.DELIVERED || event.type === EventType.PRESS) {
        setRinging({ id: notification.id, text: reminderTextOf(notification) });
      } else if (event.type === EventType.ACTION_PRESS || event.type === EventType.DISMISSED) {
        // Handled (or dismissed) some other way - the tray's own
        // buttons, or a swipe - so the overlay steps aside too.
        setRinging((prev) => (prev?.id === notification.id ? null : prev));
      }
    });
  }, []);

  if (!ringing) return null;

  async function stop() {
    await dismissReminder(ringing?.id);
    setRinging(null);
  }

  async function snooze() {
    await snoozeReminder(ringing?.id, ringing?.text ?? 'Справа');
    setRinging(null);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={stop}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="alarm" size={40} color="#fff" />
          </View>
          <Text style={styles.title}>Нагадування</Text>
          <Text style={styles.text} numberOfLines={4}>
            {ringing.text}
          </Text>
          <View style={styles.actions}>
            <Pressable style={styles.snoozeBtn} onPress={snooze}>
              <Text style={styles.snoozeLabel}>Відкласти на 10 хв</Text>
            </Pressable>
            <Pressable style={styles.stopBtn} onPress={stop}>
              <Text style={styles.stopLabel}>Готово</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const ACCENT = '#3B82F6';

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
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
