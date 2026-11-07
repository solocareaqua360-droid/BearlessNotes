import { useEffect, useMemo, useState } from 'react';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';
import type { FieldDef } from '../types';

// Every link id held by a custom database's relation field pointing at the
// links (any of the three: a site, an App Store page, a video lesson) - the
// «Додатки та сервіси» case, 2026-10-02: "технічні посилання". The same
// rule as the technical photos (useRecordPhotoIds): worked out from the
// records on every change, never stamped on the link, so it cannot drift;
// a binned record no longer counts. The link databases hide these unless
// asked, search still finds them.
export function useRecordLinkIds(): Set<string> {
  return useRecordRelationIds('links');
}

// The same for any built-in database a relation field can point at - the
// files an app's record holds are technical in Файли on the same rule.
export function useRecordRelationIds(kind: 'links' | 'files'): Set<string> {
  const [linkFieldsByDb, setLinkFieldsByDb] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<{ databaseId: string; values: Record<string, unknown> }[]>([]);

  useEffect(
    () =>
      onSnapshot(
        ownedQuery('customDatabases'),
        (snapshot) => {
          const next: Record<string, string[]> = {};
          snapshot.docs.forEach((d) => {
            const fields = (d.data().fields ?? []) as FieldDef[];
            const linkFields = fields.filter((f) => f.type === 'relation' && f.relationTarget?.kind === kind).map((f) => f.id);
            if (linkFields.length > 0) next[d.id] = linkFields;
          });
          setLinkFieldsByDb(next);
        },
        listenError('useRecordLinkIds:customDatabases')
      ),
    [kind]
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
        listenError('useRecordLinkIds:customDatabaseRows')
      ),
    []
  );

  return useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      for (const fieldId of linkFieldsByDb[row.databaseId] ?? []) {
        const value = row.values[fieldId];
        if (typeof value === 'string' && value) ids.add(value);
        else if (Array.isArray(value)) value.forEach((v) => typeof v === 'string' && v && ids.add(v));
      }
    }
    return ids;
  }, [linkFieldsByDb, rows]);
}
