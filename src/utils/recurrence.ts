import { Recurrence } from '../types';
import { dateKey, parseDateKey, WEEKDAY_FULL } from './dateLocale';

// Where a recurring task's NEXT occurrence lands, counted from the date
// the one just completed was on - one step at a time, never a batch of
// future dates (the user's own choice: "по одному, при виконанні
// поточної"). `fromDateKey` is the completed occurrence's own
// reminderDate; every recurring task has one, since a repeat rule with
// no date to advance from has nothing to count from.
export function nextRecurrenceDate(recurrence: Recurrence, fromDateKey: string): string {
  const from = parseDateKey(fromDateKey);
  const next = new Date(from);
  if (recurrence.freq === 'daily') {
    next.setDate(next.getDate() + 1);
  } else if (recurrence.freq === 'weekly') {
    next.setDate(next.getDate() + 7);
  } else if (recurrence.freq === 'monthly') {
    const day = next.getDate();
    next.setMonth(next.getMonth() + 1);
    // setMonth rolls a day that doesn't exist in the target month
    // forward into the month after it (31 Jan -> 3 Mar) - day 0 of
    // that overshot month is the last real day of the one actually
    // meant.
    if (next.getDate() !== day) next.setDate(0);
  } else {
    // 'weekday' - the next date whose own day of week matches, strictly
    // after the one just completed (so completing it today never
    // re-lands on today even if today happens to be that weekday).
    const target = recurrence.weekday ?? (from.getDay() + 6) % 7;
    do {
      next.setDate(next.getDate() + 1);
    } while ((next.getDay() + 6) % 7 !== target);
  }
  return dateKey(next);
}

// What a recurrence rule reads as, for the chip/picker - "Немає" is
// deliberately not handled here (an absent Recurrence is the caller's
// own "no repeat" state, shown as its own label).
export function recurrenceLabel(recurrence: Recurrence): string {
  switch (recurrence.freq) {
    case 'daily':
      return 'Щодня';
    case 'weekly':
      return 'Щотижня';
    case 'monthly':
      return 'Щомісяця';
    case 'weekday':
      return `Щотижня, ${WEEKDAY_FULL[recurrence.weekday ?? 0].toLowerCase()}`;
  }
}
