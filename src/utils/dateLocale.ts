// Ukrainian calendar-date helpers for CalendarScreen - kept independent of
// Intl/toLocaleString so the exact wording (short weekday/month forms) is
// under our own control rather than whatever ICU data Hermes happens to
// ship on a given device.

export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']; // index 0 = Monday
export const WEEKDAY_FULL = ['Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота', 'Неділя'];
export const MONTH_SHORT = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
export const MONTH_FULL = [
  'Січень',
  'Лютий',
  'Березень',
  'Квітень',
  'Травень',
  'Червень',
  'Липень',
  'Серпень',
  'Вересень',
  'Жовтень',
  'Листопад',
  'Грудень',
];

// 0 = Monday .. 6 = Sunday (JS's own getDay() is Sunday-first, 0..6).
export function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - mondayIndex(d));
  return d;
}

export function addDays(date: Date, amount: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + amount);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Local YYYY-MM-DD (not UTC) - this is the id a daily note's document is
// keyed by, so it has to match the calendar day the user actually sees.
export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ISO-8601 week number (Monday-first weeks, week 1 contains the year's
// first Thursday) - matches how "Week NN" is usually shown alongside a date.
export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstThursdayDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDay + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

export function getWeekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export type MonthCell = { date: Date; inMonth: boolean };

// Always 42 cells (6 full Monday-first rows) - simplest layout that fits
// every month without the grid changing height as you page between months.
export function getMonthGrid(year: number, month: number): MonthCell[] {
  const first = new Date(year, month, 1);
  const start = mondayOf(first);
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i);
    return { date, inMonth: date.getMonth() === month };
  });
}

export function formatBigDate(date: Date): string {
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

// ДД.ММ.РР - used as a diary sheet's "title" (see DiaryScreen) since the
// day itself, not whatever's typed in the title field, is what identifies
// a calendar sheet in that list.
export function formatShortDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = String(date.getFullYear()).slice(-2);
  return `${d}.${m}.${y}`;
}

// Parses a `dateKey`-shaped "YYYY-MM-DD" string back into a Date - the
// inverse of dateKey, used when a screen only carries the key (e.g. a
// diary sheet's `calendarDate` field or a "jump to this day" nav param).
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
