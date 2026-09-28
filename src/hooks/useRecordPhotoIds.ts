import { useEffect, useMemo, useState } from 'react';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';
import type { FieldDef } from '../types';

// Every photo id attached to a RECORD rather than a note - a link's own
// photos (a geo point's, and every other link's since links grew a
// card), and the values of any custom database's relation field that
// points at Photos. Worked out from the records themselves on every
// change instead of stamped onto the photo, so it can never drift out of
// step with what is actually attached, and older points need no
// backfill. A binned record no longer counts.
//
// The Photos gallery reads this to hide "technical" pictures by default -
// the user's rule: attached to a record and used in no note.
export function useRecordPhotoIds(): Set<string> {
  const [linkPhotoIds, setLinkPhotoIds] = useState<string[]>([]);
  const [photoFieldsByDb, setPhotoFieldsByDb] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<{ databaseId: string; values: Record<string, unknown> }[]>([]);

  useEffect(
    () =>
      onSnapshot(
        ownedQuery('links'),
        (snapshot) => {
          const ids: string[] = [];
          snapshot.docs.forEach((d) => {
            const data = d.data();
            if (data.deletedAt) return;
            for (const block of (data.attachments ?? []) as { id?: string; type?: string }[]) {
              if (block?.type === 'image' && block.id) ids.push(block.id);
            }
          });
          setLinkPhotoIds(ids);
        },
        listenError('useRecordPhotoIds:links')
      ),
    []
  );

  useEffect(
    () =>
      onSnapshot(
        ownedQuery('customDatabases'),
        (snapshot) => {
          const next: Record<string, string[]> = {};
          snapshot.docs.forEach((d) => {
            const fields = (d.data().fields ?? []) as FieldDef[];
            const photoFields = fields
              .filter((f) => f.type === 'relation' && f.relationTarget?.kind === 'photos')
              .map((f) => f.id);
            if (photoFields.length > 0) next[d.id] = photoFields;
          });
          setPhotoFieldsByDb(next);
        },
        listenError('useRecordPhotoIds:customDatabases')
      ),
    []
  );

  useEffect(
    () =>
      onSnapshot(
        ownedQuery('customDatabaseRows'),
        (snapshot) => {
          setRows(
            snapshot.docs
              .map((d) => d.data())
              .filter((data) => !data.deletedAt)
              .map((data) => ({ databaseId: data.databaseId as string, values: (data.values ?? {}) as Record<string, unknown> }))
          );
        },
        listenError('useRecordPhotoIds:customDatabaseRows')
      ),
    []
  );

  return useMemo(() => {
    const ids = new Set(linkPhotoIds);
    for (const row of rows) {
      for (const fieldId of photoFieldsByDb[row.databaseId] ?? []) {
        const value = row.values[fieldId];
        if (typeof value === 'string' && value) ids.add(value);
        else if (Array.isArray(value)) value.forEach((v) => typeof v === 'string' && v && ids.add(v));
      }
    }
    return ids;
  }, [linkPhotoIds, photoFieldsByDb, rows]);
}
