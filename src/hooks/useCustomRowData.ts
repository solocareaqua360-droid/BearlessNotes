import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { CustomDatabase, CustomDatabaseRow } from '../types';
import { EMPTY_ROW_DISPLAY_CONTEXT, RowDisplayContext } from '../utils/customRowDisplay';

function databaseFrom(id: string, data: Record<string, unknown>): CustomDatabase {
  return {
    id,
    name: (data.name as string) ?? 'База',
    icon: data.icon as string | undefined,
    color: data.color as string | undefined,
    fields: (data.fields as CustomDatabase['fields']) ?? [],
    createdAt: (data.createdAt as number) ?? 0,
    updatedAt: (data.updatedAt as number) ?? 0,
  };
}

function rowFrom(id: string, data: Record<string, unknown>): CustomDatabaseRow {
  return {
    id,
    databaseId: data.databaseId as string,
    values: (data.values as CustomDatabaseRow['values']) ?? {},
    tagIds: (data.tagIds as string[]) ?? [],
    groupId: data.groupId as string | undefined,
    usedInDocuments: data.usedInDocuments as Record<string, boolean> | undefined,
    createdAt: (data.createdAt as number) ?? 0,
    updatedAt: (data.updatedAt as number) ?? 0,
  };
}

// Everything ONE custom-database row needs to render itself outside its own
// screen (a 'dbRow' block in a document today, a board card later): the row
// and its database live, plus the caches its values resolve against.
//
// CustomDatabaseScreen holds the same three caches as plain screen state
// because it already subscribes to all of them for its own list; this hook
// is the same idea scoped to a single row, so an embedded card stays live -
// rename the row in its database and every document showing it updates,
// which is the point of embedding it rather than copying its text.
//
// The photos/related-database listeners only start once the database's own
// fields say they're needed (a relation field targeting Photos, or one
// targeting another database), so a plain text/number database costs
// exactly two document listeners.
export function useCustomRowData(
  databaseId: string | undefined,
  rowId: string | undefined
): { database: CustomDatabase | null; row: CustomDatabaseRow | null; context: RowDisplayContext } {
  const [database, setDatabase] = useState<CustomDatabase | null>(null);
  const [row, setRow] = useState<CustomDatabaseRow | null>(null);
  const [photos, setPhotos] = useState<RowDisplayContext['photos']>([]);
  const [relatedDatabases, setRelatedDatabases] = useState<Record<string, CustomDatabase>>({});
  const [relatedRows, setRelatedRows] = useState<Record<string, CustomDatabaseRow[]>>({});

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
    if (!rowId) {
      setRow(null);
      return;
    }
    return onSnapshot(doc(db, 'customDatabaseRows', rowId), (snapshot) => {
      const data = snapshot.data();
      setRow(data ? rowFrom(rowId, data) : null);
    });
  }, [rowId]);

  const relationFields = (database?.fields ?? []).filter((f) => f.type === 'relation');
  const needsPhotos = relationFields.some((f) => (f.relationTarget?.kind ?? 'photos') === 'photos');
  const referencedDbIds = Array.from(
    new Set(
      relationFields
        .filter((f) => f.relationTarget?.kind === 'customDb')
        .map((f) => (f.relationTarget as { kind: 'customDb'; databaseId: string }).databaseId)
    )
  );
  const referencedDbIdsKey = referencedDbIds.join(',');

  useEffect(() => {
    if (!needsPhotos) {
      setPhotos([]);
      return;
    }
    return onSnapshot(collection(db, 'photos'), (snapshot) => {
      setPhotos(
        snapshot.docs.map((d) => {
          const data = d.data();
          return { id: d.id, imageUri: data.imageUri, title: data.title, driveFileId: data.driveFileId };
        })
      );
    });
  }, [needsPhotos]);

  useEffect(() => {
    if (referencedDbIds.length === 0) return;
    const unsubs = referencedDbIds.map((id) =>
      onSnapshot(doc(db, 'customDatabases', id), (snapshot) => {
        const data = snapshot.data();
        if (!data) return;
        setRelatedDatabases((prev) => ({ ...prev, [id]: databaseFrom(id, data) }));
      })
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referencedDbIdsKey]);

  useEffect(() => {
    if (referencedDbIds.length === 0) {
      setRelatedRows({});
      return;
    }
    return onSnapshot(collection(db, 'customDatabaseRows'), (snapshot) => {
      const grouped: Record<string, CustomDatabaseRow[]> = {};
      snapshot.docs.forEach((d) => {
        const data = d.data();
        if (!referencedDbIds.includes(data.databaseId)) return;
        (grouped[data.databaseId as string] ??= []).push(rowFrom(d.id, data));
      });
      setRelatedRows(grouped);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referencedDbIdsKey]);

  const context: RowDisplayContext =
    photos.length === 0 && referencedDbIds.length === 0
      ? EMPTY_ROW_DISPLAY_CONTEXT
      : { photos, relatedDatabases, relatedRows };

  return { database, row, context };
}
