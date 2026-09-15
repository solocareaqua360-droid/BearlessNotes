import notifee from '@notifee/react-native';
import { handleReminderEvent } from '../utils/reminders';

// The snooze/dismiss buttons, tapped while the app is backgrounded or
// not running at all - Android starts a headless JS task for this, the
// same shape as the widget's task handler, so it is registered at the
// entry rather than inside the app. See utils/reminders.ts and
// AlarmRingOverlay for the foreground half of the same events.
export function registerReminderEvents() {
  notifee.onBackgroundEvent(handleReminderEvent);
}
