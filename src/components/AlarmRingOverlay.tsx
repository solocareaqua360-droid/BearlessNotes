import { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import { dismissReminder, reminderTextOf, snoozeReminder } from '../utils/reminders';
import AlarmRingCard from './AlarmRingCard';

// The in-app half of a ringing alarm - for the app already being open
// when it fires. A cold start goes to AlarmRingScreenRoot's own Activity
// instead (see plugins/withAlarmRingActivity), which is what actually
// turns the screen on and shows over the lock screen; this Modal only
// ever appears once the app is already the thing on screen.
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
    // it only fires for events after the JS runtime is already up. In
    // practice this path is now rare: a cold start goes to
    // AlarmRingScreenRoot's dedicated Activity instead, but the app can
    // still have been launched some OTHER way at the exact moment the
    // alarm was already ringing, so this stays as a fallback.
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
        <AlarmRingCard text={ringing.text} onSnooze={snooze} onStop={stop} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
