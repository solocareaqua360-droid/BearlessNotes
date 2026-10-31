import { AppRegistry } from 'react-native';
import notifee from '@notifee/react-native';
import { handleReminderEvent } from '../utils/reminders';
import AlarmRingScreenRoot from './AlarmRingScreenRoot';

// The snooze/dismiss buttons, tapped while the app is backgrounded or
// not running at all - Android starts a headless JS task for this, the
// same shape as the widget's task handler, so it is registered at the
// entry rather than inside the app. See utils/reminders.ts and
// AlarmRingOverlay for the foreground half of the same events.
//
// AlarmRingScreenRoot is registered here too, under the key its own
// native Activity (see plugins/withAlarmRingActivity) launches by name -
// a second app root, for the one screen that has to open outside the
// main app's own Activity to reach over the lock screen.
export function registerReminderEvents() {
  notifee.onBackgroundEvent(handleReminderEvent);
  AppRegistry.registerComponent('AlarmRingScreen', () => AlarmRingScreenRoot);
}
