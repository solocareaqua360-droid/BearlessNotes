import { confirm } from '../components/surfaces/Ask';
import { askWhatToKeep } from '../components/DeleteContentsHost';
import { FEATURES } from '../features';
import { describeNote, removeItems } from './deletionPlan';
import { binNote, nestedNoteCount } from './nestedNotes';

// A note to the bin, asking first what of its contents goes with it
// (the user, 2026-10-09). Resolves false when the user backed out - the
// caller then leaves everything as it was. A note with nothing in the
// bases keeps the plain one-line question it always had.
export async function binNoteAsking(id: string, title: string): Promise<boolean> {
  if (FEATURES.deleteAsksContents) {
    try {
      const plan = await describeNote(id);
      if (plan.groups.length > 0) {
        const nested = await nestedNoteCount(id);
        const chosen = await askWhatToKeep({
          title: 'Видалити нотатку?',
          subtitle: title || 'Без назви',
          noun: 'нотатку',
          place: 'цій нотатці',
          plan,
          note:
            (nested > 0 ? `Вкладених нотаток: ${nested} — підуть у кошик разом з нею. ` : '') +
            'Нотатку можна повернути з кошика протягом 30 днів.',
        });
        if (!chosen) return false;
        await binNote(id);
        if (chosen.length > 0) await removeItems(chosen);
        return true;
      }
    } catch (e) {
      console.warn('binNoteAsking', e);
    }
  }
  const yes = await confirm({
    title: 'У кошик?',
    message: 'Нотатку можна буде повернути з кошика протягом 30 днів.',
    confirmLabel: 'У кошик',
  });
  if (!yes) return false;
  await binNote(id);
  return true;
}
