import { getDocs } from '../firestore';
import { ownedQuery } from './owned';
import type { Block } from '../types';

// WHAT THE «NOTES» REALLY ARE (2026-11-03, the user: the backup copied 143 notes, «щось зберігається, чого я не бачу»). Every
// document, sorted by where the app shows it: the explorer (in a folder or in «Нерозкладене»), the calendar (a day's page),
// inside another note, inside a record of a base / a link / a board / a theme, the bin - and, the point of it all, the ones
// shown NOWHERE: a page whose owner is gone. Read-only: it counts and names, it changes nothing.

// Where an owned page's owner lives (utils/recordNotes DocOwner).
const OWNER_COLLECTION: Record<string, string> = {
  row: 'customDatabaseRows',
  link: 'links',
  note: 'documents',
  chat: 'chat',
  board: 'boards',
  theme: 'thoughtThemes',
};

const TEXT_TYPES = new Set([undefined, '', 'paragraph', 'text', 'heading', 'heading1', 'heading2', 'heading3', 'bullet', 'numbered', 'checkbox', 'todo', 'quote', 'toggle']);

function isEmpty(d: Record<string, unknown>): boolean {
  if (String(d.title ?? '').trim()) return false;
  const blocks = (d.blocks as Block[] | undefined) ?? [];
  return blocks.every((b) => !String(b.text ?? '').trim() && TEXT_TYPES.has(b.type as string | undefined));
}

const titleOf = (d: Record<string, unknown>) => String(d.title ?? '').trim() || 'Без назви';

export async function notesCensus(): Promise<string> {
  const snap = await getDocs(ownedQuery('documents'));
  const docs = snap.docs.map((s) => ({ id: s.id, d: (s.data() ?? {}) as Record<string, unknown> }));
  const alive = (x: { d: Record<string, unknown> }) => !x.d.deletedAt;
  const live = docs.filter(alive);
  const binned = docs.length - live.length;

  // Which owners still exist (and are not in their own bin), collection by collection; one that cannot be read is «unknown».
  const owners = new Map<string, Set<string> | null>();
  for (const kind of new Set(live.map((x) => (x.d.owner as { kind?: string } | undefined)?.kind).filter(Boolean) as string[])) {
    const col = OWNER_COLLECTION[kind];
    if (!col) {
      owners.set(kind, null);
      continue;
    }
    if (col === 'documents') {
      owners.set(kind, new Set(live.map((x) => x.id)));
      continue;
    }
    try {
      const s = await getDocs(ownedQuery(col));
      owners.set(kind, new Set(s.docs.filter((x) => !(x.data() as { deletedAt?: unknown }).deletedAt).map((x) => x.id)));
    } catch {
      owners.set(kind, null);
    }
  }

  const days = live.filter((x) => typeof x.d.calendarDate === 'string' && x.d.calendarDate);
  const owned = live.filter((x) => !(typeof x.d.calendarDate === 'string' && x.d.calendarDate) && x.d.owner);
  const ordinary = live.filter((x) => !(typeof x.d.calendarDate === 'string' && x.d.calendarDate) && !x.d.owner);
  const inFolder = ordinary.filter((x) => Array.isArray(x.d.tagIds) && (x.d.tagIds as unknown[]).length > 0);
  const nested = owned.filter((x) => (x.d.owner as { kind?: string }).kind === 'note');
  const technical = owned.filter((x) => (x.d.owner as { kind?: string }).kind !== 'note');
  const orphan = owned.filter((x) => {
    const o = x.d.owner as { kind?: string; id?: string };
    const set = owners.get(o.kind ?? '');
    return set !== null && set !== undefined && !set.has(o.id ?? '');
  });
  const unknownOwner = owned.filter((x) => owners.get((x.d.owner as { kind?: string }).kind ?? '') === null);
  const emptyOrdinary = ordinary.filter((x) => isEmpty(x.d));
  const emptyDays = days.filter((x) => isEmpty({ ...x.d, title: '' }));
  const byKind = new Map<string, number>();
  technical.forEach((x) => {
    const k = (x.d.owner as { kind?: string }).kind ?? '?';
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
  });
  const kindWord: Record<string, string> = { row: 'записи баз', link: 'посилання', chat: 'чат', board: 'мапи дошок', theme: 'теми думок' };
  const names = (list: typeof live, n = 8) =>
    list
      .slice(0, n)
      .map((x) => `   · ${titleOf(x.d)}`)
      .join('\n') + (list.length > n ? `\n   … ще ${list.length - n}` : '');

  return [
    `Усього документів: ${docs.length} (живих ${live.length}, у кошику ${binned}).`,
    '',
    `У провіднику: ${ordinary.length} (у папках ${inFolder.length}, у «Нерозкладене» ${ordinary.length - inFolder.length}).`,
    emptyOrdinary.length ? `   з них зовсім порожніх: ${emptyOrdinary.length}\n${names(emptyOrdinary)}` : '',
    `Аркуші щоденника (календар): ${days.length}${emptyDays.length ? `, з них порожніх ${emptyDays.length}` : ''}.`,
    `Вкладені в інші нотатки: ${nested.length}.`,
    `Сторінки записів (не в провіднику): ${technical.length}${byKind.size ? ` - ${[...byKind.entries()].map(([k, n]) => `${kindWord[k] ?? k} ${n}`).join(', ')}` : ''}.`,
    '',
    orphan.length
      ? `НЕ ВИДНО НІДЕ: ${orphan.length} - їхній власник (запис, нотатка, дошка) уже видалений:\n${names(orphan, 12)}`
      : 'Не видно ніде: 0 - кожен документ має своє місце.',
    unknownOwner.length ? `Не вдалося перевірити власника: ${unknownOwner.length}.` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}
