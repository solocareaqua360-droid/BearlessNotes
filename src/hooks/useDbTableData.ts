import { useEffect, useState } from 'react';
import { doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { ownedQuery } from '../utils/owned';
import type { CustomDatabase, CustomDatabaseRow } from '../types';
import type { RowDisplayContext } from '../utils/customRowDisplay';
import { databaseFrom, rowFrom, useRowDisplayContext } from './useCustomRowData';
import { listenError } from '../utils/listenError';

export type DbTableView = { id: string; name: string; filters: { fieldId: string; op: 'any' | 'filled' | 'empty'; values?: string[] }[]; sortField?: string; sortDir?: 'asc' | 'desc' };

// What a 'dbTable' block reads, live: its base, every record of it, the caches relation fields resolve against, and the
// base's saved views (offered as conditions to start from - their settings are COPIED into the block, never linked).
// Filtered by databaseId on the client, the same «no composite index» rule as the base's own screen.
export function useDbTableData(databaseId: string | undefined): {
  database: CustomDatabase | null;
  loaded: boolean;
  rows: CustomDatabaseRow[];
  context: RowDisplayContext;
  views: DbTableView[];
} {
  const [database, setDatabase] = useState<CustomDatabase | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<CustomDatabaseRow[]>([]);
  const [views, setViews] = useState<DbTableView[]>([]);

  useEffect(() => {
    if (!databaseId) return;
    return onSnapshot(
      doc(db, 'customDatabases', databaseId),
      (snapshot) => {
        const data = snapshot.data();
        setDatabase(data ? databaseFrom(databaseId, data) : null);
        setLoaded(true);
      },
      listenError('useDbTableData:customDatabases')
    );
  }, [databaseId]);

  useEffect(() => {
    if (!databaseId) return;
    return onSnapshot(
      ownedQuery('customDatabaseRows'),
      (snapshot) => setRows(snapshot.docs.filter((d) => d.data().databaseId === databaseId && !d.data().deletedAt).map((d) => rowFrom(d.id, d.data()))),
      listenError('useDbTableData:customDatabaseRows')
    );
  }, [databaseId]);

  useEffect(() => {
    if (!databaseId) return;
    return onSnapshot(
      ownedQuery('customDatabaseViews'),
      (snapshot) =>
        setViews(
          snapshot.docs
            .filter((d) => d.data().databaseId === databaseId)
            .map((d) => {
              const v = d.data();
              return { id: d.id, name: (v.name as string) || 'Вигляд', filters: (v.filters as DbTableView['filters']) ?? [], sortField: v.sortField as string | undefined, sortDir: v.sortDir as 'asc' | 'desc' | undefined };
            })
        ),
      listenError('useDbTableData:customDatabaseViews')
    );
  }, [databaseId]);

  const context = useRowDisplayContext(database);
  return { database, loaded, rows, context, views };
}
