import type { FolderItem } from '../hooks/useAllFolderItems';
import type { TaskAttachInfo } from '../hooks/useTaskAttachments';

// «КАНДИДАТИ НА ОЧИЩЕННЯ» (the user, 2026-10-12: a screenshot of a finished task must not live
// for ever, clutter the explorer and the Drive). A picture is a candidate when nothing holds it:
// no folder, no project, not kept, in no ordinary note, in no open task - and, for pictures that
// a task carried, old enough since that task was closed. `auto` ones are the task's own
// leftovers: those go to the bin by themselves (30 days to restore); the rest are only SHOWN.
export const CLEANUP_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

export type Candidate = { item: FolderItem; auto: boolean };

export function cleanupCandidates(
  all: FolderItem[],
  tasks: Map<string, TaskAttachInfo>,
  technicalDocs: Set<string>,
  now = Date.now()
): Candidate[] {
  const out: Candidate[] = [];
  for (const item of all) {
    if (item.kind !== 'photo') continue;
    const raw = (item.raw ?? {}) as Record<string, unknown>;
    if (raw.deletedAt || raw.keep || raw.groupId || item.tagIds.length > 0) continue;
    const info = tasks.get(item.docId);
    const used = Object.keys((raw.usedInDocuments as Record<string, boolean>) ?? {});
    const ordinary = used.filter((d) => !technicalDocs.has(d) && !(info?.docIds ?? []).includes(d));
    if (ordinary.length > 0) continue;
    if (info) {
      if (info.open) continue;
      if (info.closedAt && now - info.closedAt >= CLEANUP_DAYS * DAY) out.push({ item, auto: true });
      continue;
    }
    // Nothing holds it at all, and it is old: shown for a look, never removed by itself.
    const born = (raw.createdAt as number) ?? (raw.updatedAt as number) ?? now;
    if (used.length === 0 && now - born >= 30 * DAY) out.push({ item, auto: false });
  }
  return out;
}
