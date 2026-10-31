import { doc, getDoc, updateDoc } from '../firestore';
import { db } from '../firebase';
import { createTaskOnDate } from './copyToNote';
import { nextRecurrenceDate } from './recurrence';
import type { Block, Recurrence } from '../types';
import type { ReminderKind } from './reminders';

// TICKING A TASK FROM OUTSIDE ITS NOTE (the day river, a day note's Справи block): the task record and the
// checkbox block it mirrors in its note change together, and a recurring task brings its next one - the same
// three steps Справи's own toggle takes (TasksScreen toggleTask, CalendarScreen toggleDueReminder).
export type ToggleableTask = {
  id: string;
  text?: string;
  checked: boolean;
  documentId?: string;
  groupId?: string;
  listId?: string;
  reminderDate?: string;
  reminderTime?: string;
  reminderKind?: ReminderKind;
  recurrence?: Recurrence;
};

export async function toggleTaskEverywhere(task: ToggleableTask): Promise<void> {
  const checked = !task.checked;
  if (checked && task.recurrence && task.reminderDate) {
    createTaskOnDate(task.text ?? '', nextRecurrenceDate(task.recurrence, task.reminderDate), {
      groupId: task.groupId,
      listId: task.listId,
      recurrence: task.recurrence,
      reminderTime: task.reminderTime,
      reminderKind: task.reminderKind,
    });
  }
  updateDoc(doc(db, 'tasks', task.id), { checked });
  if (!task.documentId) return;
  const ref = doc(db, 'documents', task.documentId);
  const snap = await getDoc(ref);
  const blocks = (snap.data()?.blocks as Block[] | undefined) ?? [];
  updateDoc(ref, { blocks: blocks.map((b) => (b.id === task.id ? { ...b, checked } : b)) });
}
