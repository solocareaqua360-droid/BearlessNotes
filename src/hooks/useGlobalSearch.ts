import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { Block, CustomDatabase } from '../types';
import { TextMatch, documentMatchesQuery, findBodyMatch, findTitleMatch } from '../utils/documentPreview';
import { categoryFromSiteName } from '../utils/linkCategory';

// One search over every database. Firestore has no query that reaches
// across collections, so this is what "search everything" means here: a
// listener per collection, matched in memory. Cheap because it is only
// ever mounted while the search screen is open, and because everything
// this app stores is small - the bytes that are not (photos, files) live
// on Drive and are never part of a search.

// Where a hit came from. The label is the database's own name, so the
// results read as the menu does.
export type SearchSection = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
};

// What opening a hit does. Documents open themselves; everything else
// opens where it lives - the document it is attached to when it has one,
// otherwise its own database.
export type SearchTarget =
  | { kind: 'document'; documentId: string }
  | { kind: 'links'; category: 'video' | 'geo' | 'other' }
  | { kind: 'screen'; route: 'Photos' | 'Files' | 'Stickers' | 'Tasks' | 'Diary' }
  | { kind: 'customDatabase'; databaseId: string }
  | { kind: 'board'; boardId: string };

export type SearchHit = {
  key: string;
  section: SearchSection;
  title: string;
  // The matched fragment, for highlighting - a title match when there is
  // one, otherwise the snippet of body text the match sits in.
  match: TextMatch | null;
  updatedAt: number;
  target: SearchTarget;
};

const SECTIONS: Record<string, SearchSection> = {
  documents: { key: 'documents', label: 'Документи', icon: 'document-text-outline', color: '#3B82F6' },
  diary: { key: 'diary', label: 'Щоденник', icon: 'book-outline', color: '#F59E0B' },
  tasks: { key: 'tasks', label: 'Справи', icon: 'checkbox-outline', color: '#F97316' },
  geo: { key: 'geo', label: 'Геоточки', icon: 'location-outline', color: '#16A34A' },
  other: { key: 'other', label: 'Посилання', icon: 'link-outline', color: '#14B8A6' },
  video: { key: 'video', label: 'YouTube / TikTok', icon: 'videocam-outline', color: '#EF4444' },
  photos: { key: 'photos', label: 'Зображення', icon: 'image-outline', color: '#EC4899' },
  files: { key: 'files', label: 'Файли', icon: 'document-outline', color: '#8B5CF6' },
  stickers: { key: 'stickers', label: 'Стікери', icon: 'reader-outline', color: '#EAB308' },
  boards: { key: 'boards', label: 'Дошки', icon: 'apps-outline', color: '#0EA5E9' },
};

// The order results are shown in - documents first, because that is what
// the user is usually looking for; custom databases follow, each as its
// own section, in the order they are listed in the menu.
const SECTION_ORDER = [
  'documents',
  'diary',
  'tasks',
  'geo',
  'other',
  'video',
  'photos',
  'files',
  'stickers',
  'boards',
];

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

function plainMatch(text: string | undefined, needle: string): TextMatch | null {
  return findTitleMatch(text ?? '', needle);
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function useGlobalSearch(rawQuery: string) {
  const documents = useCollection('documents');
  const tasks = useCollection('tasks');
  const links = useCollection('links');
  const photos = useCollection('photos');
  const files = useCollection('files');
  const stickers = useCollection('stickers');
  const boards = useCollection('boards');
  const customDatabases = useCollection('customDatabases');
  const customRows = useCollection('customDatabaseRows');

  const needle = rawQuery.trim();

  return useMemo(() => {
    if (needle.length === 0) return [];
    const hits: SearchHit[] = [];

    for (const d of documents) {
      const title = asString(d.title) ?? '';
      const blocks = (d.blocks as Block[] | undefined) ?? [];
      if (!documentMatchesQuery(title, blocks, needle)) continue;
      const calendarDate = asString(d.calendarDate);
      hits.push({
        key: `document:${d.id}`,
        section: calendarDate ? SECTIONS.diary : SECTIONS.documents,
        title: title || (calendarDate ?? 'Без назви'),
        match: findTitleMatch(title, needle) ?? findBodyMatch(blocks, needle),
        updatedAt: asNumber(d.updatedAt),
        target: { kind: 'document', documentId: d.id },
      });
    }

    for (const t of tasks) {
      const text = asString(t.text) ?? '';
      const match = plainMatch(text, needle);
      if (!match) continue;
      const documentId = asString(t.documentId);
      hits.push({
        key: `task:${t.id}`,
        section: SECTIONS.tasks,
        title: text,
        match,
        updatedAt: asNumber(t.updatedAt),
        // A task is a line inside a document - opening it opens that
        // document, which is where it can actually be changed.
        target: documentId ? { kind: 'document', documentId } : { kind: 'screen', route: 'Tasks' },
      });
    }

    for (const l of links) {
      const title = asString(l.title) ?? '';
      const url = asString(l.url) ?? '';
      const match = plainMatch(title, needle) ?? plainMatch(url, needle);
      if (!match) continue;
      const category = categoryFromSiteName(asString(l.siteName));
      hits.push({
        key: `link:${l.id}`,
        section: SECTIONS[category],
        title: title || url,
        match,
        updatedAt: asNumber(l.updatedAt),
        target: { kind: 'links', category },
      });
    }

    for (const p of photos) {
      const title = asString(p.title) ?? '';
      const match = plainMatch(title, needle);
      if (!match) continue;
      const documentIds = (p.documentIds as string[] | undefined) ?? [];
      hits.push({
        key: `photo:${p.id}`,
        section: SECTIONS.photos,
        title,
        match,
        updatedAt: asNumber(p.updatedAt),
        target: documentIds[0]
          ? { kind: 'document', documentId: documentIds[0] }
          : { kind: 'screen', route: 'Photos' },
      });
    }

    for (const f of files) {
      const name = asString(f.title) || asString(f.fileName) || '';
      const match = plainMatch(name, needle);
      if (!match) continue;
      const documentIds = (f.documentIds as string[] | undefined) ?? [];
      hits.push({
        key: `file:${f.id}`,
        section: SECTIONS.files,
        title: name,
        match,
        updatedAt: asNumber(f.updatedAt),
        target: documentIds[0]
          ? { kind: 'document', documentId: documentIds[0] }
          : { kind: 'screen', route: 'Files' },
      });
    }

    for (const s of stickers) {
      if (s.trashed) continue;
      const text = asString(s.text) ?? '';
      const match = plainMatch(text, needle);
      if (!match) continue;
      hits.push({
        key: `sticker:${s.id}`,
        section: SECTIONS.stickers,
        title: text,
        match,
        updatedAt: asNumber(s.updatedAt),
        target: { kind: 'screen', route: 'Stickers' },
      });
    }

    for (const b of boards) {
      const title = asString(b.title) ?? '';
      const match = plainMatch(title, needle);
      if (!match) continue;
      hits.push({
        key: `board:${b.id}`,
        section: SECTIONS.boards,
        title,
        match,
        updatedAt: asNumber(b.updatedAt),
        target: { kind: 'board', boardId: b.id },
      });
    }

    // Every custom database is a section of its own, named and coloured
    // as its tile is - a row's title is whatever sits in the first field,
    // the same rule the rest of the app uses.
    const databasesById = new Map<string, CustomDatabase>();
    for (const c of customDatabases) {
      databasesById.set(c.id, c as unknown as CustomDatabase);
    }
    for (const row of customRows) {
      const databaseId = asString(row.databaseId);
      const database = databaseId ? databasesById.get(databaseId) : undefined;
      if (!database) continue;
      const values = (row.values as Record<string, unknown> | undefined) ?? {};
      let match: TextMatch | null = null;
      let title = '';
      for (const field of database.fields ?? []) {
        const value = asString(values[field.id]);
        if (!title && value) title = value;
        if (!match && value) match = plainMatch(value, needle);
      }
      if (!match) continue;
      hits.push({
        key: `row:${row.id}`,
        section: {
          key: `custom:${database.id}`,
          label: database.name,
          icon: (database.icon as keyof typeof Ionicons.glyphMap) ?? 'grid-outline',
          color: database.color ?? '#F97316',
        },
        title: title || 'Без назви',
        match,
        updatedAt: asNumber(row.updatedAt),
        target: { kind: 'customDatabase', databaseId: database.id },
      });
    }

    return hits;
  }, [needle, documents, tasks, links, photos, files, stickers, boards, customDatabases, customRows]);
}

// The hits, cut into the sections they belong to, in the menu's own order
// - built-in databases first, the user's own after them.
export function groupHits(hits: SearchHit[]): { section: SearchSection; hits: SearchHit[] }[] {
  const bySection = new Map<string, { section: SearchSection; hits: SearchHit[] }>();
  for (const hit of hits) {
    const existing = bySection.get(hit.section.key);
    if (existing) existing.hits.push(hit);
    else bySection.set(hit.section.key, { section: hit.section, hits: [hit] });
  }
  const groups = Array.from(bySection.values());
  groups.sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a.section.key);
    const bi = SECTION_ORDER.indexOf(b.section.key);
    // A custom database has no place in that list - they all come after
    // the built-in ones, in their own alphabetical order.
    if (ai === -1 && bi === -1) return a.section.label.localeCompare(b.section.label);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  for (const group of groups) group.hits.sort((a, b) => b.updatedAt - a.updatedAt);
  return groups;
}
