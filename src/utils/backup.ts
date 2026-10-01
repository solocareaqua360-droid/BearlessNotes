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
  backedUpIds,
  copyDriveFile,
  createDriveFolder,
  driveBackupReady,
  ensureBackupMediaFolder,
  ensureBackupsFolder,
  listBackupCopies,
  trashDriveFile,
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
//
// and, shared by all copies, «Резервні копії / Фото» and «/ Файли»: every
// photo and file once, a later copy adding only the new ones.
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
// How long a dated copy is kept before it goes to the Drive's bin.
const KEEP_DAYS = 30;
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
  // New this time, and already in the shared folders from earlier copies.
  photos: number;
  photosKept: number;
  files: number;
  filesKept: number;
  // Copies older than a month moved to the Drive's bin.
  trashed: number;
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
  const result: BackupResult = { folderName, notes: 0, databases: 0, photos: 0, photosKept: 0, files: 0, filesKept: 0, trashed: 0, failed: [] };
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
  const ordinary = want('notes') ? documents.filter((d) => !(typeof d.calendarDate === 'string' && d.calendarDate)) : [];
  // Technical notes (an app's «Розбір» - recordNotes) apart from the
  // ordinary ones, as they are apart in the app.
  const notes = ordinary.filter((d) => !d.owner);
  const technical = ordinary.filter((d) => !!d.owner);
  const notesFolder = notes.length ? await createDriveFolder('Нотатки', root) : null;
  const technicalFolder = technical.length ? await createDriveFolder('Технічні нотатки', root) : null;
  const daysFolder = days.length ? await createDriveFolder('Щоденник', root) : null;
  const allNotes = [
    ...notes.map((d) => ({ d, folder: notesFolder! })),
    ...technical.map((d) => ({ d, folder: technicalFolder! })),
    ...days.map((d) => ({ d, folder: daysFolder! })),
  ];
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

  // ---- photos and files: ONE shared folder each for all copies ----------
  // (the user's choice "В"): «Резервні копії / Фото» and «/ Файли». Each
  // photo and file is copied there once, marked with its record's id, and
  // a later copy adds only what is not there yet - no copy per backup, and
  // one deleted in the app stays here. Copied on the Drive itself when the
  // Drive has the original, sent from the phone when it does not.
  const copyNew = async (
    items: Rec[],
    stage: string,
    folderName: 'Фото' | 'Файли',
    nameOf: (r: Rec) => string,
    uriOf: (r: Rec) => string | undefined,
    mimeOf: (r: Rec) => string
  ) => {
    if (!items.length) return { added: 0, kept: 0 };
    onProgress({ stage, done: 0, total: items.length });
    // Without knowing what is there, nothing is copied - copying all of it
    // again is exactly the duplication this folder exists to avoid.
    let folder: string;
    let already: Set<string>;
    try {
      folder = await ensureBackupMediaFolder(folderName);
      already = await backedUpIds(folder);
    } catch (e) {
      result.failed.push(`${folderName}: ${(e as Error)?.message ?? e}`);
      return { added: 0, kept: 0 };
    }
    const fresh = items.filter((item) => !already.has(item.id));
    let added = 0;
    for (let i = 0; i < fresh.length; i++) {
      const item = fresh[i];
      onProgress({ stage, done: i, total: fresh.length });
      const name = nameOf(item);
      const driveId = item.driveFileId as string | undefined;
      const uri = uriOf(item);
      const ok = await attempt(name, () =>
        driveId
          ? copyDriveFile(driveId, folder, name, item.id)
          : uri
            ? uploadLocalFileToDrive(folder, uri, name, mimeOf(item), item.id)
            : Promise.reject(new Error('немає ні копії на Диску, ні файлу тут'))
      );
      if (ok) added++;
    }
    return { added, kept: items.length - fresh.length };
  };
  const photos = await copyNew(
    want('photos') ? data.photos ?? [] : [],
    'Фото',
    'Фото',
    (p) => `${String(p.title ?? '').trim() || 'Фото'} ${p.id.slice(-6)}.jpg`,
    (p) => p.imageUri as string | undefined,
    () => 'image/jpeg'
  );
  const files = await copyNew(
    want('files') ? data.files ?? [] : [],
    'Файли',
    'Файли',
    (f) => String(f.fileName ?? f.title ?? `Файл ${f.id.slice(-6)}`),
    (f) => f.fileUri as string | undefined,
    (f) => String(f.mimeType ?? 'application/octet-stream')
  );
  result.photos = photos.added;
  result.photosKept = photos.kept;
  result.files = files.added;
  result.filesKept = files.kept;

  // ---- a month of copies (the user's: "треба обмежитись місяцем все
  // старіше в корзину") ---------------------------------------------------
  // Dated copies older than 30 days go to the Drive's bin - the newest one
  // never, however old. The shared photo and file folders are not copies.
  onProgress({ stage: 'Прибираю старі копії', done: 0, total: 1 });
  await attempt('Старі копії', async () => {
    const copies = await listBackupCopies();
    const newest = copies.reduce((a, b) => (b.createdAt > a ? b.createdAt : a), 0);
    const cutoff = at.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const copy of copies) {
      if (copy.createdAt < cutoff && copy.createdAt !== newest && copy.name !== folderName) {
        await trashDriveFile(copy.id);
        result.trashed++;
      }
    }
  });

  // When and where, for Settings and the weekly offer.
  await setDoc(doc(db, 'settings', 'backup'), { lastAt: at.getTime(), lastFolder: folderName, choice }, { merge: true }).catch(() => {});
  onProgress({ stage: 'Готово', done: 1, total: 1 });
  return result;
}
