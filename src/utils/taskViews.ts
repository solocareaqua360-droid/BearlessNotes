// THE WINDOWS OF «СПРАВИ» (2026-10-09, the user's sketch «Шлях справи», after
// Things 3): the tasks are no longer one list under project tabs but a few
// separate windows, each asking one question of every task - has it been
// sorted (Вхідні), is it for today (Сьогодні), for a later day (Найближчі),
// for no day at all (Колись), or done (Зроблено). Nothing new is stored to
// put a task in a window: it follows from fields a task already has - the
// day it was starred for, its reminder's date, its project - plus `someday`.

export type TaskView = 'home' | 'inbox' | 'today' | 'upcoming' | 'someday' | 'logbook' | 'all' | `project:${string}`;

export type ViewTask = {
  checked: boolean;
  groupId?: string;
  todayMarkedDate?: string;
  reminderDate?: string;
  someday?: boolean;
  createdAt?: number;
  updatedAt?: number;
};

// Starred for today, or its reminder is today - "these are the same thing"
// (TasksScreen's isTaskToday) - or either of them is in the past and the
// task is still open: what was for yesterday and not done is for today.
export function isDueToday(t: ViewTask, today: string): boolean {
  if (t.todayMarkedDate && t.todayMarkedDate <= today) return true;
  if (t.reminderDate && t.reminderDate <= today) return true;
  return false;
}

// Carried over from an earlier day (shown as such on the row).
export function isOverdue(t: ViewTask, today: string): boolean {
  const d = t.reminderDate && t.reminderDate < today ? t.reminderDate : t.todayMarkedDate && t.todayMarkedDate < today ? t.todayMarkedDate : null;
  return !!d && !(t.todayMarkedDate === today || t.reminderDate === today);
}

export function hasDay(t: ViewTask): boolean {
  return !!t.todayMarkedDate || !!t.reminderDate;
}

export function inView<T extends ViewTask>(view: TaskView, t: T, today: string): boolean {
  switch (view) {
    case 'inbox':
      return !t.checked && !t.groupId && !hasDay(t) && !t.someday;
    case 'today':
      return !t.checked && isDueToday(t, today);
    case 'upcoming':
      return !t.checked && !!t.reminderDate && t.reminderDate > today && !isDueToday(t, today);
    case 'someday':
      return !t.checked && !!t.someday && !isDueToday(t, today);
    case 'logbook':
      return t.checked;
    default:
      return false;
  }
}

export const VIEW_META: Record<'inbox' | 'today' | 'upcoming' | 'someday' | 'logbook', { label: string; icon: string; color: string }> = {
  inbox: { label: 'Вхідні', icon: 'lc:inbox', color: '#3B82F6' },
  today: { label: 'Сьогодні', icon: 'star', color: '#F59E0B' },
  upcoming: { label: 'Найближчі', icon: 'calendar-outline', color: '#E5516B' },
  someday: { label: 'Колись', icon: 'archive-outline', color: '#A89C58' },
  logbook: { label: 'Зроблено', icon: 'checkmark-done-outline', color: '#22A06B' },
};

// Whole days since the task was written down - the quiet «3 дні» on an
// unsorted task, which is the whole of the nudge in Вхідні.
export function ageInDays(createdAt: number | undefined, now = Date.now()): number {
  if (!createdAt) return 0;
  return Math.floor((now - createdAt) / 86_400_000);
}

export function dateKeyPlus(today: string, days: number): string {
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// «Коли?» - what each answer writes. `undefined` = the field goes. A timed
// reminder is let go with the old day (its notification is cancelled by the
// caller): a new day is a plain day until a time is set again.
export type WhenChoice = 'today' | 'evening' | 'tomorrow' | 'someday' | 'none' | { date: string };

export function whenFields(
  choice: WhenChoice,
  today: string,
  t: ViewTask & { postponeCount?: number }
): Record<string, string | number | boolean | undefined> {
  const wasDue = isDueToday(t, today);
  const later = choice === 'tomorrow' || choice === 'someday' || (typeof choice === 'object' && choice.date > today);
  const postponeCount = wasDue && later ? (t.postponeCount ?? 0) + 1 : t.postponeCount;
  const clearReminder = { reminderTime: undefined, reminderKind: undefined, reminderNotificationId: undefined };
  if (choice === 'today' || choice === 'evening')
    return { todayMarkedDate: today, reminderDate: undefined, ...clearReminder, someday: undefined, evening: choice === 'evening' ? true : undefined, postponeCount };
  if (choice === 'someday')
    return { todayMarkedDate: undefined, reminderDate: undefined, ...clearReminder, someday: true, evening: undefined, postponeCount };
  if (choice === 'none')
    return { todayMarkedDate: undefined, reminderDate: undefined, ...clearReminder, someday: undefined, evening: undefined, postponeCount };
  const date = choice === 'tomorrow' ? dateKeyPlus(today, 1) : choice.date;
  if (date <= today)
    return { todayMarkedDate: today, reminderDate: undefined, ...clearReminder, someday: undefined, evening: undefined, postponeCount };
  return { todayMarkedDate: undefined, reminderDate: date, ...clearReminder, someday: undefined, evening: undefined, postponeCount };
}
