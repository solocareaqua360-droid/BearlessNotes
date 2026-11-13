import { arrayRemove, arrayUnion, doc, writeBatch } from '../firestore';
import { db } from '../firebase';
import { ALL_FOLDER_KINDS } from '../constants/folderKinds';
import type { Tag } from '../types';
import type { FolderItem } from '../hooks/useAllFolderItems';

// MERGING A FOLDER'S PER-KIND TAGS INTO ONE (stage 1a of the unified-explorer
// plan, 2026-10-10). Until now a folder was one tag PER KIND of thing, all
// with the same `path`. This only PLANS the merge - it reads and reports, it
// writes nothing (the dry run the user asked for before any real migration).
export type MergeGroup = {
  path: string;
  survivor: Tag;
  twins: Tag[];
  // Items that would be re-hung on the survivor, by kind.
  moves: Record<string, number>;
  // Items already on the survivor too (just dropped from the twin).
  alreadyThere: number;
  // What the merged tag would carry.
  types: string[];
  groupIds: string[];
  // Why this one survives.
  why: string;
  // Things that differ between the twins and would be lost or need a choice.
  notes: string[];
  // The tag's own reverse index disagrees with the items (usedIn drift).
  drift: string[];
};

const keyOf = (item: FolderItem) => `${item.tagKind}:${item.docId}`;

export function planFolderMerge(tags: Tag[], items: FolderItem[]): MergeGroup[] {
  const byPath = new Map<string, Tag[]>();
  tags.forEach((t) => byPath.set(t.path, [...(byPath.get(t.path) ?? []), t]));
  const groups: MergeGroup[] = [];
  byPath.forEach((same, path) => {
    if (same.length < 2) return;
    // The survivor: the one that carries the project and card look (they are
    // the hardest to rebuild), else the one with the most things on it.
    const score = (t: Tag) => (t.groupIds?.length ? 1000 : 0) + (t.card ? 500 : 0) + Object.keys(t.usedIn).length;
    const sorted = [...same].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
    const survivor = sorted[0];
    const twins = sorted.slice(1);
    const why = survivor.groupIds?.length || survivor.card ? 'несе проєкт/вигляд картки' : 'найбільше предметів';
    const onSurvivor = new Set(items.filter((i) => i.tagIds.includes(survivor.id)).map((i) => i.id));
    const moves: Record<string, number> = {};
    let alreadyThere = 0;
    const seen = new Set<string>();
    twins.forEach((twin) => {
      items
        .filter((i) => i.tagIds.includes(twin.id))
        .forEach((i) => {
          if (onSurvivor.has(i.id) || seen.has(i.id)) {
            alreadyThere += 1;
            return;
          }
          seen.add(i.id);
          moves[i.tagKind] = (moves[i.tagKind] ?? 0) + 1;
        });
    });
    const notes: string[] = [];
    twins.forEach((t) => {
      if (t.icon !== survivor.icon) notes.push(`іконка «${t.icon}» замість «${survivor.icon}» зникне`);
      if (t.color !== survivor.color) notes.push(`колір ${t.color} замість ${survivor.color} зникне`);
      if (t.card && survivor.card && JSON.stringify(t.card) !== JSON.stringify(survivor.card)) notes.push('у двох різний вигляд картки: лишиться один');
      if (t.keep && !survivor.keep) notes.push('«тримати порожньою» буде перенесено');
    });
    const drift: string[] = [];
    same.forEach((t) => {
      items
        .filter((i) => i.tagIds.includes(t.id) && !t.usedIn[keyOf(i)])
        .forEach((i) => drift.push(`предмет «${i.title}» стоїть у теґу, але той про нього не знає`));
      const known = new Set(items.filter((i) => i.tagIds.includes(t.id)).map(keyOf));
      Object.keys(t.usedIn)
        .filter((k) => !known.has(k))
        .forEach((k) => drift.push(`теґ пам'ятає ${k}, якого вже нема (безпечно)`));
    });
    groups.push({
      path,
      survivor,
      twins,
      moves,
      alreadyThere,
      types: Array.from(new Set(same.flatMap((t) => t.types))),
      groupIds: Array.from(new Set(same.flatMap((t) => t.groupIds ?? []))),
      why,
      notes,
      drift,
    });
  });
  return groups.sort((a, b) => a.path.localeCompare(b.path));
}

export function describePlan(groups: MergeGroup[]): string {
  if (groups.length === 0) return 'Однойменних теґів нема: зливати нічого.';
  const kinds = (m: Record<string, number>) =>
    Object.entries(m)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ') || 'нічого не переносити';
  const lines = groups.map(
    (g) =>
      `• ${g.path}: ${g.twins.length + 1} теґи в один (лишиться той, що ${g.why}). Перенести: ${kinds(g.moves)}.` +
      (g.alreadyThere ? ` Вже на головному: ${g.alreadyThere}.` : '') +
      (g.notes.length ? ` Зникне: ${g.notes.join('; ')}.` : '') +
      (g.drift.filter((d) => !d.includes('безпечно')).length ? ` УВАГА, розбіжності: ${g.drift.filter((d) => !d.includes('безпечно')).length}.` : '')
  );
  return `Папок з кількома теґами: ${groups.length}.\n${lines.join('\n')}`;
}

// THE REAL MERGE of one group (run only after the user said yes, one group at a
// time). It re-checks what it was shown: a twin that carries a project or a card
// look is NEVER dropped here (that one needs a person), and every thing still
// hanging on a twin is re-hung on the survivor before the twin goes. One batch,
// so it all lands or none of it does.
export async function applyFolderMerge(group: MergeGroup, items: FolderItem[]): Promise<{ ok: boolean; reason?: string; moved: number }> {
  const risky = group.twins.find((t) => t.groupIds?.length || t.card);
  if (risky) return { ok: false, reason: `двійник «${risky.path}» несе проєкт або вигляд картки`, moved: 0 };
  const batch = writeBatch(db);
  const survivorRef = doc(db, 'tags', group.survivor.id);
  const kinds = Array.from(new Set([...ALL_FOLDER_KINDS, ...group.types]));
  const usedInPatch: Record<string, unknown> = {};
  let moved = 0;
  const seen = new Set<string>();
  group.twins.forEach((twin) => {
    items
      .filter((i) => i.tagIds.includes(twin.id))
      .forEach((i) => {
        if (seen.has(i.id)) return;
        seen.add(i.id);
        batch.update(doc(db, i.collection, i.docId), { tagIds: arrayUnion(group.survivor.id) });
        batch.update(doc(db, i.collection, i.docId), { tagIds: arrayRemove(twin.id) });
        usedInPatch[`usedIn.${keyOf(i)}`] = true;
        moved += 1;
      });
  });
  batch.update(survivorRef, { types: arrayUnion(...kinds), ...(group.twins.some((t) => t.keep) ? { keep: true } : {}), ...usedInPatch });
  group.twins.forEach((t) => batch.delete(doc(db, 'tags', t.id)));
  await batch.commit();
  return { ok: true, moved };
}
