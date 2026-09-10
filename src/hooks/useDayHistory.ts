import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { CustomDatabase } from '../types';
import { rowTitleOf } from '../utils/customRowDisplay';
import { dateKey } from '../utils/dateLocale';

// "Everything that appeared this day" is derived entirely from records that
// already exist for other reasons - every kind here already carries its own
// `createdAt` - rather than a written-at-creation-time log of its own. That
// keeps the whole feature at zero new write paths: nothing can drift out of
// sync with reality, because there's nothing to keep in sync.
export type HistoryItemKind =
  | 'file'
  | 'photo'
  | 'link-video'
  | 'link-geo'
  | 'link-other'
  | 'document'
  | 'board'
  | 'task'
  | 'sticker'
  | 'customRow'
  | 'customView';

export type HistoryItem = {
  id: string;
  kind: HistoryItemKind;
  title: string;
  createdAt: number;
  // The document a task lives in, or a document item's own id - what
  // "open this" navigates to.
  documentId?: string;
  // Which custom database a row/view belongs to.
  databaseId?: string;
  // Whatever a "natural open" needs beyond the fields above - a file's
  // uri/name/mimeType for Sharing.shareAsync, a photo's uri for the zoom
  // viewer, a link's url to play/open. Absent for kinds whose open is pure
  // navigation (document/board/task/customRow/customView).
  data?: Record<string, unknown>;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function categoryOf(siteName: string | undefined): 'link-video' | 'link-geo' | 'link-other' {
  if (siteName?.includes('YouTube') || siteName?.includes('TikTok')) return 'link-video';
  if (siteName === 'Геоточка') return 'link-geo';
  return 'link-other';
}

// One collection, range-filtered by createdAt, mapped to HistoryItems - the
// shape every one of the nine subscriptions below shares; only the mapper
// differs.
function useCreatedAtItems(
  collectionName: string,
  startMs: number,
  endMs: number,
  mapItem: (id: string, data: Record<string, unknown>) => HistoryItem | HistoryItem[] | null
): HistoryItem[] {
  const [items, setItems] = useState<HistoryItem[]>([]);
  useEffect(() => {
    const q = query(collection(db, collectionName), where('createdAt', '>=', startMs), where('createdAt', '<=', endMs));
    return onSnapshot(q, (snapshot) => {
      const next: HistoryItem[] = [];
      snapshot.docs.forEach((d) => {
        const mapped = mapItem(d.id, d.data());
        if (!mapped) return;
        if (Array.isArray(mapped)) next.push(...mapped);
        else next.push(mapped);
      });
      setItems(next);
    });
    // mapItem is a fresh closure every render by design (it captures things
    // like customDatabases below) - re-subscribing on every change of the
    // range is the real dependency; mapItem changing more often than that
    // only means re-mapping the same already-cached snapshot, which
    // onSnapshot itself does not re-fetch for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, startMs, endMs]);
  return items;
}

// Everything that appeared on any day in view, for the calendar's blue dot
// and its per-day "Історія" list. `unbounded` widens the range the same way
// the existing filled-days queries do while their own "only X days" strip
// is active - a personal history is small enough that this is still one
// cheap query per collection, not real pagination.
export function useDayHistory(
  visibleYear: number,
  visibleMonth: number,
  unbounded: boolean
): { historyByDate: Map<string, HistoryItem[]>; historyDates: Set<string> } {
  const [startMs, endMs] = useMemo(() => {
    if (unbounded) return [0, Number.MAX_SAFE_INTEGER];
    const start = new Date(visibleYear, visibleMonth, 1);
    start.setDate(start.getDate() - 7);
    const end = new Date(visibleYear, visibleMonth + 1, 0);
    end.setDate(end.getDate() + 8); // +7 padding, +1 to cover the end day itself
    return [start.getTime(), end.getTime()];
  }, [visibleYear, visibleMonth, unbounded]);

  // Needed only to resolve a custom-database row's real title (its own
  // fields[0] value) and name - loaded whole rather than per-row, since a
  // personal app has few enough custom databases for this to be cheap, and
  // it's the same "avoid a composite index" tradeoff used everywhere else.
  const [customDatabases, setCustomDatabases] = useState<Record<string, CustomDatabase>>({});
  useEffect(() => {
    return onSnapshot(collection(db, 'customDatabases'), (snapshot) => {
      const next: Record<string, CustomDatabase> = {};
      snapshot.docs.forEach((d) => {
        const data = d.data();
        next[d.id] = {
          id: d.id,
          name: data.name,
          icon: data.icon,
          color: data.color,
          fields: data.fields ?? [],
          createdAt: data.createdAt ?? 0,
          updatedAt: data.updatedAt ?? 0,
        };
      });
      setCustomDatabases(next);
    });
  }, []);

  const files = useCreatedAtItems('files', startMs, endMs, (id, data) => ({
    id,
    kind: 'file',
    title: (data.title as string) || (data.fileName as string) || 'Файл',
    createdAt: data.createdAt as number,
    data: { fileUri: data.fileUri, fileName: data.fileName, mimeType: data.mimeType },
  }));

  const photos = useCreatedAtItems('photos', startMs, endMs, (id, data) => ({
    id,
    kind: 'photo',
    title: (data.title as string) || 'Фото',
    createdAt: data.createdAt as number,
    data: { imageUri: data.imageUri },
  }));

  const links = useCreatedAtItems('links', startMs, endMs, (id, data) => ({
    id,
    kind: categoryOf(data.siteName as string | undefined),
    title: (data.title as string) || (data.url as string) || 'Посилання',
    createdAt: data.createdAt as number,
    data: { url: data.url, imageUrl: data.imageUrl },
  }));

  // A regular document only - a daily note (`calendarDate` set) IS the
  // day's own sheet, not something that happened during it.
  const documents = useCreatedAtItems('documents', startMs, endMs, (id, data) => {
    if (data.calendarDate) return null;
    return {
      id,
      kind: 'document',
      title: (data.title as string) || 'Без назви',
      createdAt: data.createdAt as number,
      documentId: id,
    };
  });

  const boards = useCreatedAtItems('boards', startMs, endMs, (id, data) => ({
    id,
    kind: 'board',
    title: (data.title as string) || 'Без назви',
    createdAt: data.createdAt as number,
  }));

  const tasks = useCreatedAtItems('tasks', startMs, endMs, (id, data) => ({
    id,
    kind: 'task',
    title: (data.text as string) || 'Справа',
    createdAt: data.createdAt as number,
    documentId: data.documentId as string,
  }));

  const stickers = useCreatedAtItems('stickers', startMs, endMs, (id, data) => {
    if (data.trashed) return null;
    const label =
      data.type === 'paragraph'
        ? (data.text as string) || 'Порожній стікер'
        : data.type === 'image'
          ? 'Фото-стікер'
          : 'Малюнок-стікер';
    return { id, kind: 'sticker', title: label, createdAt: data.createdAt as number };
  });

  const customRows = useCreatedAtItems('customDatabaseRows', startMs, endMs, (id, data) => {
    const database = customDatabases[data.databaseId as string];
    return {
      id,
      kind: 'customRow',
      title: rowTitleOf(database, {
        id,
        databaseId: data.databaseId as string,
        values: (data.values as Record<string, string | number | string[]>) ?? {},
        createdAt: 0,
        updatedAt: 0,
      }),
      createdAt: data.createdAt as number,
      databaseId: data.databaseId as string,
    };
  });

  const customViews = useCreatedAtItems('customDatabaseViews', startMs, endMs, (id, data) => ({
    id,
    kind: 'customView',
    title: (data.name as string) || 'Вигляд',
    createdAt: data.createdAt as number,
    databaseId: data.databaseId as string,
  }));

  return useMemo(() => {
    const all = [...files, ...photos, ...links, ...documents, ...boards, ...tasks, ...stickers, ...customRows, ...customViews];
    const byDate = new Map<string, HistoryItem[]>();
    all.forEach((item) => {
      if (!item.createdAt) return;
      const key = dateKey(new Date(item.createdAt));
      const list = byDate.get(key) ?? [];
      list.push(item);
      byDate.set(key, list);
    });
    // Chronological within a day - the earliest thing added first.
    byDate.forEach((list) => list.sort((a, b) => a.createdAt - b.createdAt));
    return { historyByDate: byDate, historyDates: new Set(byDate.keys()) };
  }, [files, photos, links, documents, boards, tasks, stickers, customRows, customViews]);
}
