import * as Notifications from 'expo-notifications';

// One shared Android channel for every task reminder - HIGH importance is
// enough for a heads-up alert with sound, without MAX's more aggressive
// full-screen behavior a plain task reminder doesn't need. No custom sound
// file or exact-alarm permission (Android 12+) yet - the system's default
// notification sound and "close enough" timing are the deliberately simple
// first pass here.
const ANDROID_CHANNEL_ID = 'reminders';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let channelReady: Promise<void> | null = null;

function ensureChannel(): Promise<void> {
  if (!channelReady) {
    channelReady = Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Нагадування про справи',
      importance: Notifications.AndroidImportance.HIGH,
    }).then(() => undefined);
  }
  return channelReady;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export function reminderDateTime(reminderDate: string, reminderTime: string): Date {
  const [y, m, d] = reminderDate.split('-').map(Number);
  const [h, min] = reminderTime.split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0);
}

// Returns the new notification's id, or undefined if permission was denied
// or the moment has already passed (the reminder still shows as a
// date/time badge, it just won't fire) - callers store this alongside
// reminderDate/reminderTime so scheduleReminder/cancelReminder can find it
// again later.
export async function scheduleReminder(
  taskText: string,
  reminderDate: string,
  reminderTime: string
): Promise<string | undefined> {
  const fireDate = reminderDateTime(reminderDate, reminderTime);
  if (fireDate.getTime() <= Date.now()) return undefined;
  const granted = await ensureNotificationPermission();
  if (!granted) return undefined;
  await ensureChannel();
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Нагадування',
      body: taskText || 'Справа',
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireDate,
      channelId: ANDROID_CHANNEL_ID,
    },
  });
}

export async function cancelReminder(notificationId: string | undefined): Promise<void> {
  if (!notificationId) return;
  await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => {});
}
