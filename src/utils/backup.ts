import * as XLSX from 'xlsx';
import { getDocs } from '../firestore';
import { ownedQuery, setDoc } from './owned';
import { doc } from '../firestore';
import { db } from '../firebase';
import { OWNED_COLLECTIONS } from './claimOwnership';
import { buildDocumentHtml } from './documentBlocks';
import { stripFormatting } from './documentPreview';
import { displayFieldValue, rowTitleOf, type RowDisplayContext } from './customRowDisplay';
import { categoryFromSiteName } from './linkCategory';
import {
  copyDriveFile,
  createDriveFolder,
  driveBackupReady,
  ensureBackupsFolder,
  uploadLocalFileToDrive,
  uploadToDrive,
} from './googleDrive';
import type { Block, CustomDatabase, CustomDatabaseRow, FieldDef } from '../types';

// A FULL COPY OF EVERYTHING ON THE GOOGLE DRIVE (the user's, 2026-10-02):
// "повний експорт всіх документів, баз данних, дошок". One folder per copy,
// under «Bearless Notes / Резервні копії», named by when it was made:
//
//   mindEva - архів.json   every record of every collection, as it is -
//                          what a restore reads back (the PDFs and Docs
//                          cannot be read back into the app)
//   Нотатки/               each note as a Google Doc
//   Щоденник/              the days' notes, named by their date
//   Бази/                  each personal database, Tasks and Links as a
//                          Google Sheet
//   Фото/, Файли/          the originals, copied on the Drive itself
//
// Nothing is overwritten: a later copy is a new folder, and a note changed
// since is in it as it is now, while the older copy keeps it as it was.
// Boards (as PDF) are the next step.
//
// The same code on the phone and in the Mac app; googleDrive(.web) is
// what differs. Every item is tried on its own: one note Drive refuses is
// counted and listed, and the copy goes on.

// The collections the owner check lists, and the four it misses (written
// with an owner all the same, so the same query reads them).
const COLLECTIONS = [...OWNED_COLLECTIONS, 'chat', 'linkArticles', 'linkArticleTranslations', 'scheduleCellStatuses'];

const GOOGLE_DOC = 'application/vnd.google-apps.document';
const GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type BackupProgress = { stage: string; done: number; total: number };

// WHAT GOES INTO A COPY (the user's: "не факт що я захочу зберігати
// всі"): the sections, and inside «Бази» each database on its own - the
// personal ones by id, Tasks and Links by these two keys. The archive is
// always whole: a restore with half the records is not a restore.
export type BackupSection = 'notes' | 'days' | 'databases' | 'photos' | 'files';
export const BACKUP_SECTIONS: { key: BackupSection; label: string }[] = [
  { key: 'notes', label: 'Нотатки' },
  { key: 'days', label: 'Щоденник' },
  { key: 'databases', label: 'Бази' },
  { key: 'photos', label: 'Фото' },
  { key: 'files', label: 'Файли' },
];
export const TASKS_SHEET = '__tasks__';
export const LINKS_SHEET = '__links__';
export type BackupChoice = { skipSections: BackupSection[]; skipDatabases: string[] };
export const FULL_BACKUP: BackupChoice = { skipSections: [], skipDatabases: [] };
export type BackupResult = {
  folderName: string;
  notes: number;
  databases: number;
  photos: number;
  files: number;
  failed: string[];
};

type Rec = Record<string, unknown> & { id: string };

const pad = (n: number) => String(n).padStart(2, '0');
function stamp(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}-${pad(at.getMinutes())}`;
}
function dateOf(ms: unknown): string {
  if (typeof ms !== 'number' || !ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function readAll(onProgress: (p: BackupProgress) => void): Promise<Record<string, Rec[]>> {
  const out: Record<string, Rec[]> = {};
  for (let i = 0; i < COLLECTIONS.length; i++) {
    const name = COLLECTIONS[i];
    onProgress({ stage: 'Читаю дані', done: i, total: COLLECTIONS.length });
    const snapshot = await getDocs(ownedQuery(name));
    out[name] = snapshot.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, ...d.data() }));
  }
  return out;
}

function sheetBase64(name: string, header: string[], rows: string[][]): string {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  // A sheet's name is limited to 31 characters and a few symbols.
  XLSX.utils.book_append_sheet(book, sheet, name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Аркуш');
  return XLSX.write(book, { type: 'base64', bookType: 'xlsx' }) as string;
}

export async function backupToDrive(
  onProgress: (p: BackupProgress) => void,
  choice: BackupChoice = FULL_BACKUP
): Promise<BackupResult> {
  const want = (section: BackupSection) => !choice.skipSections.includes(section);
  const wantSheet = (key: string) => want('databases') && !choice.skipDatabases.includes(key);
  if (!(await driveBackupReady())) throw new Error('Google Диск не підключено');
  const at = new Date();
  const folderName = stamp(at);
  const result: BackupResult = { folderName, notes: 0, databases: 0, photos: 0, files: 0, failed: [] };
  const attempt = async (label: string, work: () => Promise<unknown>) => {
    try {
      await work();
      return true;
    } catch (e) {
      result.failed.push(`${label}: ${(e as Error)?.message ?? e}`);
      return false;
    }
  };

  const data = await readAll(onProgress);

  onProgress({ stage: 'Створюю папку копії', done: 0, total: 1 });
  const root = await createDriveFolder(folderName, await ensureBackupsFolder());

  // The archive first: it is the one part a restore needs, so it is the
  // one part that must be there even if the rest is cut short.
  onProgress({ stage: 'Архів даних', done: 0, total: 1 });
  await uploadToDrive(
    root,
    'mindEva - архів.json',
    'application/json',
    { text: JSON.stringify({ app: 'mindEva', version: 1, createdAt: at.getTime(), collections: data }) }
  );

  // ---- notes ------------------------------------------------------------
  const documents = (data.documents ?? []).filter((d) => !d.deletedAt);
  const days = want('days') ? documents.filter((d) => typeof d.calendarDate === 'string' && d.calendarDate) : [];
  const notes = want('notes') ? documents.filter((d) => !(typeof d.calendarDate === 'string' && d.calendarDate)) : [];
  const notesFolder = notes.length ? await createDriveFolder('Нотатки', root) : null;
  const daysFolder = days.length ? await createDriveFolder('Щоденник', root) : null;
  const allNotes = [...notes.map((d) => ({ d, folder: notesFolder! })), ...days.map((d) => ({ d, folder: daysFolder! }))];
  for (let i = 0; i < allNotes.length; i++) {
    const { d, folder } = allNotes[i];
    onProgress({ stage: 'Нотатки', done: i, total: allNotes.length });
    const title = String(d.title ?? '').trim() || 'Без назви';
    const name = typeof d.calendarDate === 'string' && d.calendarDate ? `${d.calendarDate} ${title}` : title;
    const ok = await attempt(name, async () => {
      const html = await buildDocumentHtml(title, (d.blocks as Block[] | undefined) ?? []);
      await uploadToDrive(folder, name, 'text/html', { text: html }, GOOGLE_DOC);
    });
    if (ok) result.notes++;
  }

  // ---- databases as sheets ---------------------------------------------
  const databases = (data.customDatabases ?? []) as unknown as CustomDatabase[];
  const rowsOf = (id: string) =>
    ((data.customDatabaseRows ?? []) as unknown as CustomDatabaseRow[]).filter((r) => r.databaseId === id);
  const groupName = (id: unknown) => (data.groups ?? []).find((g) => g.id === id)?.name as string | undefined;
  const ctx: RowDisplayContext = {
    photos: (data.photos ?? []).map((p) => ({ id: p.id, imageUri: String(p.imageUri ?? ''), title: p.title as string | undefined })),
    files: (data.files ?? []).map((f) => ({ id: f.id, title: f.title as string | undefined, fileName: f.fileName as string | undefined })),
    links: (data.links ?? []).map((l) => ({
      id: l.id,
      url: String(l.url ?? ''),
      title: l.title as string | undefined,
      category: categoryFromSiteName(l.siteName as string | undefined),
    })),
    relatedDatabases: Object.fromEntries(databases.map((x) => [x.id, x])),
    relatedRows: Object.fromEntries(databases.map((x) => [x.id, rowsOf(x.id)])),
  };
  const sheets: { name: string; header: string[]; rows: string[][] }[] = databases.filter((x) => wantSheet(x.id)).map((database) => {
    const fields: FieldDef[] = database.fields ?? [];
    return {
      name: database.name || 'База',
      header: ['Запис', ...fields.map((f) => f.name)],
      rows: rowsOf(database.id).map((row) => [
        rowTitleOf(database, row),
        ...fields.map((f) => displayFieldValue(f, row.values?.[f.id], ctx)),
      ]),
    };
  });
  const tasks = data.tasks ?? [];
  if (tasks.length && wantSheet(TASKS_SHEET)) {
    const listName = (id: unknown) => (data.taskLists ?? []).find((l) => l.id === id)?.name as string | undefined;
    sheets.push({
      name: 'Справи',
      header: ['Справа', 'Виконано', 'Проект', 'Список', 'Статус', 'Нагадування', 'Створено'],
      rows: tasks.map((t) => [
        stripFormatting(String(t.text ?? '')),
        t.checked ? 'так' : '',
        groupName(t.groupId) ?? '',
        listName(t.listId) ?? '',
        String(t.kanbanStatus ?? ''),
        [t.reminderDate, t.reminderTime].filter(Boolean).join(' '),
        dateOf(t.createdAt),
      ]),
    });
  }
  const links = data.links ?? [];
  if (links.length && wantSheet(LINKS_SHEET)) {
    sheets.push({
      name: 'Посилання',
      header: ['Назва', 'Адреса', 'Сайт', 'Проект', 'Створено'],
      rows: links.map((l) => [
        String(l.title ?? ''),
        String(l.url ?? ''),
        String(l.siteName ?? ''),
        groupName(l.groupId) ?? '',
        dateOf(l.createdAt),
      ]),
    });
  }
  if (sheets.length) {
    const basesFolder = await createDriveFolder('Бази', root);
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i];
      onProgress({ stage: 'Бази', done: i, total: sheets.length });
      const ok = await attempt(sheet.name, () =>
        uploadToDrive(basesFolder, sheet.name, XLSX_TYPE, { base64: sheetBase64(sheet.name, sheet.header, sheet.rows) }, GOOGLE_SHEET)
      );
      if (ok) result.databases++;
    }
  }

  // ---- photos and files: copied on the Drive, or sent from here ---------
  const copyAll = async (
    items: Rec[],
    stage: string,
    folderName: string,
    nameOf: (r: Rec) => string,
    uriOf: (r: Rec) => string | undefined,
    mimeOf: (r: Rec) => string
  ) => {
    if (!items.length) return 0;
    const folder = await createDriveFolder(folderName, root);
    let count = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      onProgress({ stage, done: i, total: items.length });
      const name = nameOf(item);
      const driveId = item.driveFileId as string | undefined;
      const uri = uriOf(item);
      const ok = await attempt(name, () =>
        driveId ? copyDriveFile(driveId, folder, name) : uri ? uploadLocalFileToDrive(folder, uri, name, mimeOf(item)) : Promise.reject(new Error('немає ні копії на Диску, ні файлу тут'))
      );
      if (ok) count++;
    }
    return count;
  };
  result.photos = await copyAll(
    want('photos') ? data.photos ?? [] : [],
    'Фото',
    'Фото',
    (p) => `${String(p.title ?? '').trim() || 'Фото'} ${p.id.slice(-6)}.jpg`,
    (p) => p.imageUri as string | undefined,
    () => 'image/jpeg'
  );
  result.files = await copyAll(
    want('files') ? data.files ?? [] : [],
    'Файли',
    'Файли',
    (f) => String(f.fileName ?? f.title ?? `Файл ${f.id.slice(-6)}`),
    (f) => f.fileUri as string | undefined,
    (f) => String(f.mimeType ?? 'application/octet-stream')
  );

  // When and where, for Settings and the weekly offer.
  await setDoc(doc(db, 'settings', 'backup'), { lastAt: at.getTime(), lastFolder: folderName, choice }, { merge: true }).catch(() => {});
  onProgress({ stage: 'Готово', done: 1, total: 1 });
  return result;
}
