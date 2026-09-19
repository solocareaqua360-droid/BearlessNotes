import notifee, {
  AlarmType,
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  AuthorizationStatus,
  EventType,
  TriggerType,
  type Event,
} from '@notifee/react-native';

// A task reminder is one of two things now, chosen per task: a quiet
// notification, or a real alarm.
//
// The user first asked for the alarm only ("Мені ж потрібен варіант 2 з
// точним часом повноцінний"), so that replaced the plain notification
// everywhere - and then found the plain one gone entirely: "Мені
// потрібно для деяких справ сповіщання для деяких будильник вперед."
// Both live side by side here, chosen by `reminderKind` on the block
// (see ReminderSheet's own toggle) and never mixed in one notification.
//
// What makes the alarm a real alarm, and none of it is what
// expo-notifications (the very first, simple pass) could do:
//
// - AlarmType.SET_ALARM_CLOCK is Android's OWN alarm-clock API - the
//   same one a real alarm app uses. It fires at the exact minute and
//   wakes the device out of Doze, and unlike the newer exact-alarm
//   types it needs NO permission a user (or Android 12+) can silently
//   revoke - it has worked this way since API 21.
// - loopSound + FLAG_INSISTENT (see AndroidChannel/loopSound below)
//   repeats the sound until the notification is opened or cancelled,
//   the way an alarm rings rather than chimes once.
// - fullScreenAction + AndroidCategory.ALARM + bypassDnd bring the
//   device to attention even locked or in Do Not Disturb, opening
//   AlarmRingActivity - its own Activity, in its own process, that can
//   turn the screen on and show over the lock screen - see
//   plugins/withAlarmRingActivity.
//
// Honest ceiling, still open: the alarm's sound plays on the
// notification's own channel, not Android's separate ALARM volume
// stream - that needs a small native module of its own
// (AudioAttributes.USAGE_ALARM) and is a distinct piece of work.
const ALARM_CHANNEL_ID = 'reminders-alarm';
const NOTIFY_CHANNEL_ID = 'reminders-notify';
// Matches app.json's android.package - see plugins/withAlarmRingActivity.
const ANDROID_PACKAGE = 'com.bearlessnotes.notes';

export type ReminderKind = 'notify' | 'alarm';

let alarmChannelReady: Promise<void> | null = null;
let notifyChannelReady: Promise<void> | null = null;

function ensureAlarmChannel(): Promise<void> {
  if (!alarmChannelReady) {
    alarmChannelReady = notifee
      .createChannel({
        id: ALARM_CHANNEL_ID,
        name: 'Будильник для справ',
        description: 'Нагадування, що дзвонить як будильник',
        importance: AndroidImportance.HIGH,
        sound: 'default',
        vibration: true,
        vibrationPattern: [300, 700, 300, 700],
        // So it rings even with the phone on Do Not Disturb - an alarm
        // that could be silenced by DND would not be an alarm.
        bypassDnd: true,
        visibility: AndroidVisibility.PUBLIC,
      })
      .then(() => undefined);
  }
  return alarmChannelReady;
}

function ensureNotifyChannel(): Promise<void> {
  if (!notifyChannelReady) {
    notifyChannelReady = notifee
      .createChannel({
        id: NOTIFY_CHANNEL_ID,
        name: 'Сповіщення про справи',
        description: 'Тихе нагадування о вказаний час - один сигнал, без дзвінка',
        importance: AndroidImportance.HIGH,
        sound: 'default',
        vibration: true,
      })
      .then(() => undefined);
  }
  return notifyChannelReady;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const settings = await notifee.requestPermission();
  return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
}

export function reminderDateTime(reminderDate: string, reminderTime: string): Date {
  const [y, m, d] = reminderDate.split('-').map(Number);
  const [h, min] = reminderTime.split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0);
}

// One place both a fresh alarm and a snooze go through, so the two can
// never drift into different shapes.
async function createAlarm(taskText: string, fireDate: Date): Promise<string> {
  return notifee.createTriggerNotification(
    {
      title: 'Нагадування',
      body: taskText || 'Справа',
      // 'task-alarm' is what tells AlarmRingOverlay/AlarmRingScreenRoot
      // this is one of theirs to draw a ring screen for - a plain
      // notification (createNotification below) never carries it.
      data: { kind: 'task-alarm', taskText },
      android: {
        channelId: ALARM_CHANNEL_ID,
        category: AndroidCategory.ALARM,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        // Rings until dealt with, not until the tray happens to get
        // cleared - see loopSound's own doc: it stops at the first of
        // "opened" or "cancelled", both of which the app does itself
        // (AlarmRingOverlay, snooze/dismiss below).
        loopSound: true,
        ongoing: true,
        autoCancel: false,
        pressAction: { id: 'default' },
        // A dedicated Activity, in its own process, that turns the
        // screen on and shows itself over the lock screen without the
        // phone being unlocked first - see plugins/withAlarmRingActivity
        // and AlarmRingScreenRoot. Plain notifee full-screen intents
        // into the app's own MainActivity only bring the app forward;
        // MainActivity has no reason to ever bypass the lock screen for
        // ordinary use, so that had to be a separate, isolated Activity.
        fullScreenAction: { id: 'default', launchActivity: `${ANDROID_PACKAGE}.AlarmRingActivity` },
        actions: [
          { title: 'Відкласти на 10 хв', pressAction: { id: 'snooze' } },
          { title: 'Готово', pressAction: { id: 'dismiss' } },
        ],
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: fireDate.getTime(),
      alarmManager: { type: AlarmType.SET_ALARM_CLOCK },
    }
  );
}

// The other kind: a single, ordinary, dismissible notification - what
// this whole module was before the alarm existed, and what some tasks
// still just need. No loop, no full-screen intent, no DND bypass, no
// actions of its own - tapping it opens the app and clears it, the way
// every other notification behaves.
async function createNotification(taskText: string, fireDate: Date): Promise<string> {
  return notifee.createTriggerNotification(
    {
      title: 'Нагадування',
      body: taskText || 'Справа',
      android: {
        channelId: NOTIFY_CHANNEL_ID,
        category: AndroidCategory.REMINDER,
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: fireDate.getTime(),
      // WorkManager (notifee's default when alarmManager is unset) is
      // "close enough" timing, deliberately - the exact/alarm-clock path
      // is what the ALARM kind above asks for; a plain notification has
      // no reason to spend that same weight on being to-the-minute.
    }
  );
}

// Returns the new reminder's id, or undefined if permission was denied
// or the moment has already passed (the reminder still shows as a
// date/time badge, it just won't fire) - callers store this alongside
// reminderDate/reminderTime/reminderKind so scheduleReminder/
// cancelReminder can find it again later.
export async function scheduleReminder(
  taskText: string,
  reminderDate: string,
  reminderTime: string,
  kind: ReminderKind
): Promise<string | undefined> {
  const fireDate = reminderDateTime(reminderDate, reminderTime);
  if (fireDate.getTime() <= Date.now()) return undefined;
  const granted = await ensureNotificationPermission();
  if (!granted) return undefined;
  if (kind === 'alarm') {
    await ensureAlarmChannel();
    return createAlarm(taskText, fireDate);
  }
  await ensureNotifyChannel();
  return createNotification(taskText, fireDate);
}

export async function cancelReminder(notificationId: string | undefined): Promise<void> {
  if (!notificationId) return;
  await notifee.cancelTriggerNotification(notificationId).catch(() => {});
  // A trigger that has already FIRED is a plain displayed notification
  // by the time this runs (editing or clearing a reminder after it
  // rang) - cancelTriggerNotification alone leaves that one ringing.
  await notifee.cancelNotification(notificationId).catch(() => {});
}

const SNOOZE_MINUTES = 10;

// The two things a ringing ALARM can be told to do, called by name -
// used by the background handler below AND by AlarmRingOverlay's/
// AlarmRingScreenRoot's own buttons, so tapping "Готово" in the tray and
// tapping it on the in-app ring screen do exactly the same thing.
// Neither touches Firestore or the task's own stored
// reminderNotificationId: a snooze is a NEW, separate alarm ten minutes
// out, which is what every alarm app's snooze is - the task's own
// schedule in the database stays put. A plain notification has neither
// action, so these are never called for one.
export async function dismissReminder(notificationId: string | undefined): Promise<void> {
  if (notificationId) await notifee.cancelNotification(notificationId).catch(() => {});
}

export async function snoozeReminder(notificationId: string | undefined, taskText: string): Promise<void> {
  if (notificationId) await notifee.cancelNotification(notificationId).catch(() => {});
  await ensureAlarmChannel();
  await createAlarm(taskText, new Date(Date.now() + SNOOZE_MINUTES * 60 * 1000));
}

// The one function to read a ringing alarm's own text back off it,
// shared by the background handler and the foreground overlay.
export function reminderTextOf(notification: Event['detail']['notification']): string {
  return (notification?.data?.taskText as string | undefined) ?? notification?.body ?? 'Справа';
}

// The snooze/dismiss buttons, pressed from the TRAY while the app is
// backgrounded or not running at all - registered once in
// src/notifications/register.ts. See AlarmRingOverlay for the same two
// actions reached from inside the app instead. A plain notification
// carries neither action button, so this only ever fires for alarms.
export async function handleReminderEvent(event: Event): Promise<void> {
  if (event.type !== EventType.ACTION_PRESS) return;
  const notification = event.detail.notification;
  const actionId = event.detail.pressAction?.id;
  if (actionId === 'snooze') await snoozeReminder(notification?.id, reminderTextOf(notification));
  else if (actionId === 'dismiss') await dismissReminder(notification?.id);
}
