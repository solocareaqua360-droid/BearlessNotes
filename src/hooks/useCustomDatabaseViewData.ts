import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { CustomDatabase, CustomDatabaseRow, CustomDatabaseView } from '../types';
import { applyRowFilters, sortRows } from '../utils/customRowQuery';
import { RowDisplayContext } from '../utils/customRowDisplay';
import { databaseFrom, rowFrom, useRowDisplayContext } from './useCustomRowData';

function viewFrom(id: string, data: Record<string, unknown>): CustomDatabaseView {
  return {
    id,
    databaseId: data.databaseId as string,
    name: (data.name as string) ?? 'Вигляд',
    viewMode: (data.viewMode as CustomDatabaseView['viewMode']) ?? 'list',
    sortField: (data.sortField as string) ?? 'updatedAt',
    sortDir: (data.sortDir as CustomDatabaseView['sortDir']) ?? 'desc',
    filters: (data.filters as CustomDatabaseView['filters']) ?? [],
    usedInDocuments: data.usedInDocuments as Record<string, boolean> | undefined,
    createdAt: (data.createdAt as number) ?? 0,
    updatedAt: (data.updatedAt as number) ?? 0,
  };
}

// Everything a 'dbView' block needs to render its live slice of a database:
// the view and its database, every row currently matching the view's
// filter/sort, and the caches those rows' relation fields resolve against.
//
// `databaseId` is taken separately from the view rather than read off it
// once loaded, the same reason 'dbRow' blocks carry dbRowDatabaseId
// alongside a row id: it's what lets the caller tell "still loading" apart
// from "this view was deleted" - the database subscription proves Firestore
// is actually answering before the missing view is called deleted rather
// than just not-in-yet.
export function useCustomDatabaseViewData(
  databaseId: string | undefined,
  viewId: string | undefined
): {
  database: CustomDatabase | null;
  view: CustomDatabaseView | null;
  rows: CustomDatabaseRow[];
  context: RowDisplayContext;
} {
  const [database, setDatabase] = useState<CustomDatabase | null>(null);
  const [view, setView] = useState<CustomDatabaseView | null>(null);
  const [rawRows, setRawRows] = useState<CustomDatabaseRow[]>([]);

  useEffect(() => {
    if (!databaseId) {
      setDatabase(null);
      return;
    }
    return onSnapshot(doc(db, 'customDatabases', databaseId), (snapshot) => {
      const data = snapshot.data();
      setDatabase(data ? databaseFrom(databaseId, data) : null);
    });
  }, [databaseId]);

  useEffect(() => {
    if (!viewId) {
      setView(null);
      return;
    }
    return onSnapshot(doc(db, 'customDatabaseViews', viewId), (snapshot) => {
      const data = snapshot.data();
      setView(data ? viewFrom(viewId, data) : null);
    });
  }, [viewId]);

  useEffect(() => {
    if (!databaseId) {
      setRawRows([]);
      return;
    }
    // Filtered client-side by databaseId, same "avoid a composite index"
    // convention CustomDatabaseScreen's own rows query follows.
    return onSnapshot(query(collection(db, 'customDatabaseRows')), (snapshot) => {
      setRawRows(
        snapshot.docs
          .map((d) => rowFrom(d.id, d.data()))
          .filter((r) => r.databaseId === databaseId)
      );
    });
  }, [databaseId]);

  const context = useRowDisplayContext(database);
  const rows = view
    ? sortRows(applyRowFilters(rawRows, view.filters ?? [], database), { field: view.sortField, dir: view.sortDir }, database, context)
    : [];

  return { database, view, rows, context };
}
