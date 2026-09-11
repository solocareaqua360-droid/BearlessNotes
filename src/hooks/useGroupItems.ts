import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot, orderBy, query } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { CustomDatabase, CustomDatabaseRow, Group } from '../types';
import { labelForKind } from '../utils/groups';
import { rowTitleOf } from '../utils/customRowDisplay';

// Everything a group can gather, and where each kind actually lives. Tasks
// are deliberately absent: they have their own "проєкти" field, which the
// user was explicit shouldn't be the same thing as a group.
const SOURCES: { kind: string; collectionName: string }[] = [
  { kind: 'document', collectionName: 'documents' },
  { kind: 'photo', collectionName: 'photos' },
  { kind: 'file', collectionName: 'files' },
  { kind: 'link', collectionName: 'links' },
  { kind: 'customRow', collectionName: 'customDatabaseRows' },
];

export type GroupItem = {
  id: string;
  kind: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  // 'customRow' only - which database it belongs to, for opening it.
  databaseId?: string;
  // The source record's own fields, kept so importing it onto a board can
  // build a card without re-reading the document it came from.
  data: Record<string, unknown>;
};

function linkKindOf(siteName: string | undefined): string {
  const name = siteName ?? '';
  if (name.includes('YouTube') || name.includes('TikTok')) return 'link-video';
  if (name === 'Геоточка') return 'link-geo';
  return 'link-other';
}

const ICON_BY_KIND: Record<string, keyof typeof Ionicons.glyphMap> = {
  document: 'document-text-outline',
  photo: 'image-outline',
  file: 'document-outline',
  'link-video': 'videocam-outline',
  'link-geo': 'location-outline',
  'link-other': 'link-outline',
};

// Every group and everything filed under it, gathered once and shared by
// the two places that need it: the groups screen, where a group is seen
// whole, and a board, which can now pull a group onto itself without
// sending the user to that screen first.
//
// A group holds on the order of a hundred items, so its contents are found
// by scanning each collection for a matching groupId rather than keeping a
// reverse index on the group itself - one less thing to hold in step, and
// the same client-side filtering every database screen here already does
// instead of composite indexes.
export function useGroupItems() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [customDatabases, setCustomDatabases] = useState<CustomDatabase[]>([]);
  const [itemsByGroup, setItemsByGroup] = useState<Record<string, GroupItem[]>>({});
  const [customRowsById, setCustomRowsById] = useState<Record<string, CustomDatabaseRow>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'groups'), orderBy('name')), (snapshot) => {
      setGroups(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) })));
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, 'customDatabases'), (snapshot) => {
      setCustomDatabases(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomDatabase, 'id'>) })));
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, 'customDatabaseRows'), (snapshot) => {
      const map: Record<string, CustomDatabaseRow> = {};
      snapshot.docs.forEach((d) => {
        map[d.id] = { id: d.id, ...(d.data() as Omit<CustomDatabaseRow, 'id'>) };
      });
      setCustomRowsById(map);
    });
  }, []);

  useEffect(() => {
    const unsubs = SOURCES.map((source) =>
      onSnapshot(collection(db, source.collectionName), (snapshot) => {
        setItemsByGroup((prev) => {
          const next: Record<string, GroupItem[]> = {};
          // Rebuild only this source's contribution, keeping the others.
          Object.entries(prev).forEach(([groupId, items]) => {
            next[groupId] = items.filter((i) => !i.kind.startsWith(source.kind));
          });
          snapshot.docs.forEach((d) => {
            const data = d.data();
            const groupId = data.groupId as string | undefined;
            if (!groupId) return;
            let kind = source.kind;
            let title = '';
            let databaseId: string | undefined;
            if (source.kind === 'document') {
              if (data.calendarDate) return; // daily notes aren't filed by hand
              title = (data.title as string) || 'Без назви';
            } else if (source.kind === 'photo') {
              title = (data.title as string) || 'Без назви';
            } else if (source.kind === 'file') {
              title = (data.title as string) || (data.fileName as string) || 'Без назви';
            } else if (source.kind === 'link') {
              kind = linkKindOf(data.siteName as string | undefined);
              title = (data.title as string) || (data.url as string) || 'Без назви';
            } else {
              databaseId = data.databaseId as string;
              kind = `customRow:${databaseId}`;
              title = 'Запис';
            }
            (next[groupId] ??= []).push({
              id: d.id,
              kind,
              title,
              icon: ICON_BY_KIND[kind] ?? 'grid-outline',
              databaseId,
              data,
            });
          });
          return next;
        });
      })
    );
    return () => unsubs.forEach((u) => u());
  }, []);

  const customDatabaseNames = Object.fromEntries(customDatabases.map((d) => [d.id, d.name])) as Record<string, string>;

  // A custom-database row's real title only becomes readable once its
  // database's field list is in (the title is whatever its first field
  // holds), so it's resolved here rather than during the scan above.
  function titleForItem(item: GroupItem): string {
    if (!item.databaseId) return item.title;
    const database = customDatabases.find((d) => d.id === item.databaseId) ?? null;
    const row = customRowsById[item.id];
    return row ? rowTitleOf(database, row) : item.title;
  }

  return {
    groups,
    itemsByGroup,
    customDatabases,
    customDatabaseNames,
    customRowsById,
    isLoading,
    titleForItem,
    labelForItemKind: (kind: string) => labelForKind(kind, customDatabaseNames),
  };
}
