import { useEffect, useState } from 'react';
import { collection, onSnapshot } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { categoryFromSiteName } from '../utils/linkCategory';

// What each database has in it, for the tiles to show. A tile that only
// carries an icon gets emptier the bigger it is made; a count and the
// newest thing in it are what make a large tile worth having.
//
// Plain listeners rather than count queries on purpose: a count query has
// to reach the server, and this screen has to open with the app offline
// like everything else. These collections are already in the cache from
// the screens that list them, so a second listener costs almost nothing.

export type PinnableItem = {
  id: string;
  name: string;
  color: string;
  icon: string;
  count: number;
};

export type DatabaseContents = {
  counts: Record<string, number>;
  // The newest record's own title, per database.
  latest: Record<string, string>;
  // The newest few images, for the photo tile to show instead of an icon.
  photoThumbs: string[];
  // What can be pinned to the board beside the databases: a group (the
  // theme of a period, counted across every database it touches) and a
  // smart folder (counted by what it is actually on).
  pinnableGroups: PinnableItem[];
  pinnableTags: PinnableItem[];
};

type Row = Record<string, unknown> & { id: string };

function useCollection(name: string): Row[] {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(
    () =>
      onSnapshot(collection(db, name), (snapshot) => {
        setRows(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })));
      }),
    [name]
  );
  return rows;
}

function newest(rows: Row[], titleOf: (row: Row) => string | undefined): string {
  let best: Row | undefined;
  for (const row of rows) {
    const at = Number(row.updatedAt ?? 0);
    if (!best || at > Number(best.updatedAt ?? 0)) best = row;
  }
  return (best && titleOf(best)) || '';
}

export function useDatabaseContents(): DatabaseContents {
  const documents = useCollection('documents');
  const tasks = useCollection('tasks');
  const links = useCollection('links');
  const photos = useCollection('photos');
  const files = useCollection('files');
  const stickers = useCollection('stickers');
  const boards = useCollection('boards');
  const tags = useCollection('tags');
  const groups = useCollection('groups');
  const customRows = useCollection('customDatabaseRows');

  // Daily notes live in the documents collection but are the diary, not
  // the documents - the same split the documents list itself makes.
  const notes = documents.filter((d) => !d.calendarDate);
  const diary = documents.filter((d) => !!d.calendarDate);
  const byCategory = { geo: [] as Row[], other: [] as Row[], video: [] as Row[] };
  for (const link of links) {
    byCategory[categoryFromSiteName(link.siteName as string | undefined)].push(link);
  }

  const counts: Record<string, number> = {
    documents: notes.length,
    diary: diary.length,
    tasks: tasks.length,
    geo: byCategory.geo.length,
    links: byCategory.other.length,
    video: byCategory.video.length,
    photos: photos.length,
    files: files.length,
    stickers: stickers.filter((s) => !s.trashed).length,
    board: boards.length,
    tags: tags.length,
    groups: groups.length,
  };
  for (const row of customRows) {
    const id = row.databaseId as string | undefined;
    if (id) counts[id] = (counts[id] ?? 0) + 1;
  }

  const latest: Record<string, string> = {
    documents: newest(notes, (d) => d.title as string | undefined),
    tasks: newest(tasks, (t) => t.text as string | undefined),
    geo: newest(byCategory.geo, (l) => (l.title as string) || (l.url as string)),
    links: newest(byCategory.other, (l) => (l.title as string) || (l.url as string)),
    video: newest(byCategory.video, (l) => (l.title as string) || (l.url as string)),
    files: newest(files, (f) => (f.title as string) || (f.fileName as string)),
    stickers: newest(
      stickers.filter((s) => !s.trashed),
      (s) => s.text as string | undefined
    ),
    board: newest(boards, (b) => b.title as string | undefined),
  };

  // A group crosses databases, so its count does too.
  const inGroup = (id: string) =>
    [...notes, ...tasks, ...links, ...photos, ...files, ...customRows].filter((r) => r.groupId === id)
      .length;
  const pinnableGroups: PinnableItem[] = groups.map((g) => ({
    id: g.id,
    name: (g.name as string) ?? '',
    color: (g.color as string) ?? '#9CA3AF',
    icon: 'albums-outline',
    count: inGroup(g.id),
  }));
  const pinnableTags: PinnableItem[] = tags.map((t) => ({
    id: t.id,
    name: (t.path as string) ?? '',
    color: (t.color as string) ?? '#9CA3AF',
    icon: (t.icon as string) ?? 'pricetag-outline',
    count: Object.keys((t.usedIn as Record<string, unknown>) ?? {}).length,
  }));

  const photoThumbs = [...photos]
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))
    .slice(0, 4)
    .map((p) => p.imageUri as string)
    .filter(Boolean);

  return { counts, latest, photoThumbs, pinnableGroups, pinnableTags };
}
