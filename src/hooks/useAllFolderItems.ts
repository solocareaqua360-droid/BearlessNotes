import { useEffect, useMemo, useState } from 'react';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';
import { categoryFromSiteName } from '../utils/linkCategory';
import type { Block, Tag } from '../types';

// EVERYTHING THAT IS IN A FOLDER, from every database at once - the
// folders' own canvas (the folders rework, step 1, 2026-10-02: folders
// run through photos, files, notes and the rest, "є ризик в них
// заплутатися, тому тут полотно повинно врятувати"). Only what carries
// at least one folder: the folders screen is about folders, and every
// record of every database loose on one table would bury them.
export type FolderItemKind = 'document' | 'photo' | 'file' | 'link' | 'flashcard' | 'board' | 'row';

export type FolderItem = {
  // Unique across databases: `${collection}:${docId}`.
  id: string;
  docId: string;
  kind: FolderItemKind;
  // The tag kind a folder records it under (useTags' attach/detach).
  tagKind: string;
  collection: string;
  tagIds: string[];
  title: string;
  imageUri?: string;
  driveFileId?: string;
  imageUrl?: string;
  fileName?: string;
  blocks?: Block[];
  linkCategory?: 'video' | 'geo' | 'other';
  databaseId?: string;
};

type Raw = Record<string, unknown>;
type Source = {
  collection: string;
  make: (id: string, data: Raw) => FolderItem | null;
};

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const base = (collection: string, docId: string, data: Raw, kind: FolderItemKind, tagKind: string, title: string): FolderItem => ({
  id: `${collection}:${docId}`,
  docId,
  kind,
  tagKind,
  collection,
  tagIds: ids(data.tagIds),
  title,
});

const SOURCES: Source[] = [
  {
    collection: 'documents',
    // Not the diary's days, not an app's technical notes (recordNotes).
    make: (id, d) =>
      d.calendarDate || d.owner
        ? null
        : { ...base('documents', id, d, 'document', 'document', str(d.title) || 'Без назви'), blocks: (d.blocks as Block[]) ?? [] },
  },
  {
    collection: 'photos',
    make: (id, d) => ({
      ...base('photos', id, d, 'photo', 'photo', str(d.title) || 'Фото'),
      imageUri: str(d.imageUri),
      driveFileId: str(d.driveFileId),
    }),
  },
  {
    collection: 'files',
    make: (id, d) => ({
      ...base('files', id, d, 'file', 'file', str(d.title) || str(d.fileName) || 'Файл'),
      fileName: str(d.fileName) ?? '',
    }),
  },
  {
    collection: 'links',
    make: (id, d) => {
      const category = categoryFromSiteName(str(d.siteName));
      return {
        ...base('links', id, d, 'link', `link-${category}`, str(d.title) || str(d.url) || 'Посилання'),
        imageUrl: str(d.imageUrl),
        linkCategory: category,
      };
    },
  },
  {
    collection: 'flashcards',
    make: (id, d) => ({ ...base('flashcards', id, d, 'flashcard', 'flashcard', str(d.term) || 'Картка') }),
  },
  {
    collection: 'boards',
    make: (id, d) => ({ ...base('boards', id, d, 'board', 'board', str(d.title) || str(d.name) || 'Дошка') }),
  },
  {
    collection: 'customDatabaseRows',
    make: (id, d) => {
      const databaseId = str(d.databaseId);
      if (!databaseId) return null;
      const values = (d.values ?? {}) as Record<string, unknown>;
      // The first text value stands for the record's name here - the
      // database's own title field needs the database, and this is a
      // glance, not its page.
      const first = Object.values(values).find((v) => typeof v === 'string' && v.trim()) as string | undefined;
      return { ...base('customDatabaseRows', id, d, 'row', `customRow:${databaseId}`, first?.trim() || 'Запис'), databaseId };
    },
  },
];

export function useAllFolderItems(tags: Tag[]): FolderItem[] {
  const [byCollection, setByCollection] = useState<Record<string, FolderItem[]>>({});
  useEffect(() => {
    const stops = SOURCES.map((source) =>
      onSnapshot(
        ownedQuery(source.collection),
        (snapshot) => {
          const next: FolderItem[] = [];
          snapshot.docs.forEach((d) => {
            const data = d.data() as Raw;
            if (data.deletedAt) return;
            const item = source.make(d.id, data);
            if (item && item.tagIds.length > 0) next.push(item);
          });
          setByCollection((prev) => ({ ...prev, [source.collection]: next }));
        },
        listenError(`useAllFolderItems:${source.collection}`)
      )
    );
    return () => stops.forEach((stop) => stop());
  }, []);
  const tagIds = useMemo(() => new Set(tags.map((t) => t.id)), [tags]);
  return useMemo(
    () => Object.values(byCollection).flat().filter((item) => item.tagIds.some((id) => tagIds.has(id))),
    [byCollection, tagIds]
  );
}
