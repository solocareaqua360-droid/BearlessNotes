import { useEffect, useState } from 'react';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';

// WHICH PICTURES BELONG TO A TASK (the cleanup of 2026-10-12): a screenshot added to a task is
// not a picture of its own, it is part of the task. For every photo id that some task carries:
// whether any such task is still OPEN, when the last one was closed, and which notes those
// tasks live in (a task is mirrored as a block in a note - that note is NOT «a use» of the
// picture). Worked out from the tasks on every change, never stamped, so it cannot drift.
export type TaskAttachInfo = { open: boolean; closedAt: number; docIds: string[] };

export function useTaskAttachments(): Map<string, TaskAttachInfo> {
  const [map, setMap] = useState<Map<string, TaskAttachInfo>>(new Map());
  useEffect(
    () =>
      onSnapshot(
        ownedQuery('tasks'),
        (snapshot) => {
          const next = new Map<string, TaskAttachInfo>();
          snapshot.docs.forEach((d) => {
            const data = d.data();
            if (data.deletedAt) return;
            for (const block of (data.attachments ?? []) as { id?: string; type?: string }[]) {
              if (block?.type !== 'image' || !block.id) continue;
              const info = next.get(block.id) ?? { open: false, closedAt: 0, docIds: [] };
              if (!data.checked) info.open = true;
              else info.closedAt = Math.max(info.closedAt, (data.updatedAt as number) ?? 0);
              if (data.documentId && !info.docIds.includes(data.documentId as string)) info.docIds.push(data.documentId as string);
              next.set(block.id, info);
            }
          });
          setMap(next);
        },
        listenError('useTaskAttachments')
      ),
    []
  );
  return map;
}
