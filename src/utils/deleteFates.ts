import { ask, type AskFate, type AskFateTone } from '../components/surfaces/Ask';
import type { BoardCard, BoardItem } from '../types';
import { describeBoards, refOf, type PlanItem } from './deletionPlan';
import { askWhatToKeep } from '../components/DeleteContentsHost';
import { categoryFromSiteName } from './linkCategory';

// THE FATE OF EACH THING (the user, 2026-10-25): every delete - in a folder, a note or a board - first says, kind by
// kind, where each thing goes: for good, into the bin, or nowhere (it stays in its base or its folder). One more
// «Видалити» / «Скасувати»; no switches here (the board's «Що лишити?» keeps its own).

export type FateKind =
  | 'document'
  | 'board'
  | 'flashcard'
  | 'photo'
  | 'link-video'
  | 'link-other'
  | 'link-geo'
  | 'file'
  | 'shortcut'
  | 'task'
  | 'folder'
  | 'collection'
  | 'card'
  | 'shape';

const KINDS: Record<FateKind, { title: string; icon: string; base: string }> = {
  folder: { title: 'Папки', icon: 'folder-outline', base: 'Провідник' },
  collection: { title: 'Підбірки', icon: 'albums-outline', base: 'Провідник' },
  shortcut: { title: 'Ярлики', icon: 'rocket-outline', base: 'Провідник' },
  document: { title: 'Нотатки', icon: 'document-text-outline', base: 'Нотатки' },
  board: { title: 'Дошки', icon: 'easel-outline', base: 'Дошки' },
  flashcard: { title: 'Картки', icon: 'albums-outline', base: 'Картки' },
  photo: { title: 'Зображення', icon: 'image-outline', base: 'Зображення' },
  'link-video': { title: 'Відео', icon: 'play-circle-outline', base: 'Відео' },
  'link-other': { title: 'Посилання', icon: 'link-outline', base: 'Посилання' },
  'link-geo': { title: 'Геоточки', icon: 'location-outline', base: 'Геоточки' },
  file: { title: 'Файли', icon: 'document-outline', base: 'Файли' },
  task: { title: 'Справи', icon: 'checkbox-outline', base: 'Справи' },
  card: { title: 'Картки дошки', icon: 'square-outline', base: 'Дошки' },
  shape: { title: 'Фігури й написи', icon: 'shapes-outline', base: 'Дошки' },
};

export const baseOf = (kind: FateKind) => KINDS[kind].base;

// The words for the usual fates, so every place says them the same way.
export const FATE = {
  bin: 'ідуть у кошик - можна відновити',
  forever: 'видаляються назавжди',
  stays: (kind: FateKind) => `лишаються в базі «${KINDS[kind].base}»`,
};

export type FateEntry = { kind: FateKind; tone: AskFateTone; fate: string };

// One row per kind and fate, «Файли · 2».
export function fateRows(entries: FateEntry[]): AskFate[] {
  const groups = new Map<string, { entry: FateEntry; n: number }>();
  for (const e of entries) {
    const key = `${e.kind}|${e.tone}|${e.fate}`;
    const g = groups.get(key);
    if (g) g.n += 1;
    else groups.set(key, { entry: e, n: 1 });
  }
  // In the order the caller gave them: what is deleted first, then what was in it (a board above its notes).
  return [...groups.values()]
    .map(({ entry, n }) => ({ icon: KINDS[entry.kind].icon, label: `${KINDS[entry.kind].title} · ${n}`, fate: entry.fate, tone: entry.tone }));
}

export async function confirmFates(options: { title: string; message?: string; entries: FateEntry[]; confirmLabel?: string }): Promise<boolean> {
  return (await askFates(options)) === 'ok';
}

// The same, with one more way on (a board's «Що лишити?»): 'ok', the extra one's id, or 'cancel'.
export function askFates(options: { title: string; message?: string; entries: FateEntry[]; confirmLabel?: string; extra?: { id: string; label: string } }): Promise<string> {
  return ask({
    title: options.title,
    message: options.message,
    fates: fateRows(options.entries),
    actions: [{ id: 'ok', label: options.confirmLabel ?? 'Видалити', tone: 'danger' }, ...(options.extra ? [{ id: options.extra.id, label: options.extra.label }] : [])],
  });
}

// A WHOLE BOARD going (the user, 2026-10-25: the board's window said nothing of what stays and what goes with it): the
// records its cards show stay in their bases (each once); its own cards and its shapes go to the bin inside it.
export function boardContentsFates(boards: { cards?: BoardCard[]; shapes?: unknown[] }[]): FateEntry[] {
  const seen = new Set<string>();
  const entries: FateEntry[] = [];
  for (const b of boards) {
    for (const card of b.cards ?? []) {
      const ref = refOf(card);
      if (!ref) {
        entries.push({ kind: 'card', tone: 'bin', fate: 'ідуть у кошик разом з дошкою' });
        continue;
      }
      if (seen.has(`${ref.collection}:${ref.id}`)) continue;
      seen.add(`${ref.collection}:${ref.id}`);
      const kind: FateKind = ref.kind === 'note' ? 'document' : ref.kind === 'link' ? (`link-${categoryFromSiteName(card.linkSiteName)}` as FateKind) : ref.kind;
      entries.push({ kind, tone: 'stays', fate: FATE.stays(kind) });
    }
    for (let n = 0; n < (b.shapes?.length ?? 0); n++) entries.push({ kind: 'shape', tone: 'bin', fate: 'ідуть у кошик разом з дошкою' });
  }
  return entries;
}

// A board's card: one that shows a record (a note, board, picture, file, link) only leaves the board - the record stays in
// its base; any other card (a sticky, text, a list) lives inside the board and goes with it.
export function boardCardFate(card: BoardCard): FateEntry {
  const ref = refOf(card);
  if (!ref) return { kind: 'card', tone: 'forever', fate: 'зникають з дошки (поверне лише «Назад»)' };
  const kind: FateKind =
    ref.kind === 'note' ? 'document' : ref.kind === 'link' ? (`link-${categoryFromSiteName(card.linkSiteName)}` as FateKind) : ref.kind;
  return { kind, tone: 'stays', fate: `прибираються з дошки, ${FATE.stays(kind)}` };
}

// Boards deleted from their own base, the same as from the explorer: the fates, then (only if asked) the old «Що лишити?»
// for the records. Resolves the records chosen to go too, or null when the user walked away.
export async function askBoardsGo(going: BoardItem[], every: BoardItem[]): Promise<PlanItem[] | null> {
  const inside = boardContentsFates(going);
  const answer = await askFates({
    title: going.length === 1 ? `Видалити дошку «${going[0].title || 'Без назви'}»?` : `Видалити дошки (${going.length})?`,
    entries: [...going.map(() => ({ kind: 'board' as const, tone: 'bin' as const, fate: FATE.bin })), ...inside],
    extra: inside.some((e) => e.tone === 'stays') ? { id: 'pick', label: 'Вибрати, що з баз теж видалити…' } : undefined,
  });
  if (answer === 'ok') return [];
  if (answer !== 'pick') return null;
  const plan = await describeBoards(going, every);
  if (plan.groups.length === 0) return [];
  const chosen = await askWhatToKeep({
    title: going.length === 1 ? 'Видалити дошку?' : `Видалити дошки (${going.length})?`,
    subtitle: going.map((b) => b.title || 'Без назви').join(', '),
    noun: going.length === 1 ? 'дошки' : 'дощок',
    plan,
    withIt: going.length === 1 ? 'нею' : 'ними',
    place: going.length === 1 ? 'цій дошці' : 'цих дошках',
  });
  return chosen ?? null;
}
