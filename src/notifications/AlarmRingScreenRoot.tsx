import { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import notifee from '@notifee/react-native';
import { dismissReminder, reminderTextOf, snoozeReminder } from '../utils/reminders';
import AlarmRingCard from '../components/AlarmRingCard';

// The JS side of AlarmRingActivity (see plugins/withAlarmRingActivity):
// a whole separate Android Activity, in its own process, that the
// alarm's fullScreenAction opens directly - the one thing a plain
// notifee full-screen intent into the app's own MainActivity cannot do
// on its own, because MainActivity has no reason to ever bypass the
// lock screen for ordinary use. This root component is ALL that
// Activity ever shows: there is no navigator, no rest of the app here,
// just the ring card, full-bleed.
//
// Registered under the AppRegistry key 'AlarmRingScreen' - see
// src/notifications/register.ts. Reads the notification that launched
// it the same way AlarmRingOverlay reads a cold start, because that is
// exactly what this is: a cold start, just into a different Activity.
export default function AlarmRingScreenRoot() {
  const [ringing, setRinging] = useState<{ id: string | undefined; text: string } | null>(null);

  useEffect(() => {
    notifee.getInitialNotification().then((initial) => {
      setRinging({ id: initial?.notification?.id, text: reminderTextOf(initial?.notification) });
    });
  }, []);

  function finish() {
    // This Activity's only job was to show the alarm - once it has been
    // dealt with there is nothing left for it to do, so it closes
    // itself. It runs in its own process (android:process in the
    // manifest), so this never touches the main app even if it is
    // running in the background at the same moment.
    BackHandler.exitApp();
  }

  async function stop() {
    await dismissReminder(ringing?.id);
    finish();
  }

  async function snooze() {
    await snoozeReminder(ringing?.id, ringing?.text ?? 'Справа');
    finish();
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        {ringing && <AlarmRingCard text={ringing.text} onSnooze={snooze} onStop={stop} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.92)',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
