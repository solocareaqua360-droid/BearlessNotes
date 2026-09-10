import * as XLSX from 'xlsx';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { downloadFileFromDrive } from './googleDrive';
import { addDoc, collection, doc, getDocs, query, writeBatch } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { CustomDatabaseRow, FieldDef, FieldType } from '../types';

// One sheet as a plain grid of strings, header row included - everything
// downstream (type guessing, the mapping UI, the write) works off this and
// never touches SheetJS again.
export type ParsedSheet = { name: string; grid: string[][] };

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// A file already in the Files database only ever stores a local path (see
// backupFileToDrive) - on a device that never created it, that path is
// empty and the Drive copy is the only one there is. Same restore step
// useCachedAttachment does for thumbnails, as a plain call for the one-off
// case of reading a file to import it.
export async function ensureLocalFile(uri: string, driveFileId?: string): Promise<boolean> {
  const info = await LegacyFileSystem.getInfoAsync(uri);
  if (info.exists) return true;
  if (!driveFileId) return false;
  return downloadFileFromDrive(driveFileId, uri);
}

// Whether a file in the Files database is worth offering as an import
// source - by its own name, since that's what the user recognises and what
// the picker filters on anyway.
export function isTableFileName(name: string): boolean {
  return /\.(xlsx|xls|csv)$/i.test(name.trim());
}

// SheetJS reads .xlsx, .xls and .csv from the same call - it sniffs the
// content rather than trusting the extension, so one path covers all three
// and a file the user renamed still imports.
export async function parseTableFile(uri: string): Promise<ParsedSheet[]> {
  const base64 = await LegacyFileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  const workbook = XLSX.read(base64, { type: 'base64', cellDates: false, raw: false });
  return workbook.SheetNames.map((name) => ({
    name,
    // header:1 gives rows as plain arrays (not keyed by header), defval
    // keeps ragged rows rectangular so a column index always means the
    // same column.
    grid: XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[name], {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    }),
  }));
}

// Accepts what people actually type: 2026-09-11, 11.09.2026, 11/09/2026.
// Returns the app's own dateKey shape, or null if it isn't a date at all.
export function normalizeDate(value: string): string | null {
  const v = value.trim();
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const dmy = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return null;
}

// A first guess at what a column holds, offered as the pre-selected type in
// the mapping screen - always overridable there, since no heuristic gets
// every column right.
export function guessFieldType(values: string[]): FieldType {
  const filled = values.map((v) => (v ?? '').trim()).filter((v) => v !== '');
  if (filled.length === 0) return 'text';
  if (filled.every((v) => !Number.isNaN(Number(v.replace(',', '.'))))) return 'number';
  if (filled.every((v) => normalizeDate(v) !== null)) return 'date';
  // Few distinct values, each repeating: that's a category, not free text.
  const distinct = new Set(filled.map((v) => v.toLowerCase()));
  if (distinct.size <= 20 && distinct.size * 2 <= filled.length) return 'select';
  return 'text';
}

// What one column of the file becomes on the database side.
export type ColumnMapping =
  | { kind: 'skip' }
  // fieldId is generated up front and carried through to the FieldDef this
  // column becomes, so the write step matches columns to fields by id.
  // Matching by name would merge two columns that happen to share a header.
  | { kind: 'newField'; fieldId: string; name: string; type: FieldType; relationDatabaseId?: string }
  | { kind: 'existingField'; fieldId: string };

// Firestore caps a batch at 500 writes; a row is one write, and relation
// resolution can add a few more, so this leaves clear headroom.
const BATCH_LIMIT = 400;

// Resolves a relation cell ("Толкін") to a row id in the target database,
// creating that row if the name isn't there yet - the whole point of
// importing two related files: the writers get created by the books' own
// writer column, without a second pass by hand.
class RelationResolver {
  private byTitle = new Map<string, string>();
  private created: { id: string; databaseId: string; values: Record<string, string> }[] = [];

  constructor(
    private databaseId: string,
    private titleFieldId: string,
    existingRows: CustomDatabaseRow[]
  ) {
    existingRows.forEach((r) => {
      const title = String(r.values[titleFieldId] ?? '').trim().toLowerCase();
      if (title) this.byTitle.set(title, r.id);
    });
  }

  resolve(value: string): string | null {
    const title = value.trim();
    if (!title) return null;
    const key = title.toLowerCase();
    const existing = this.byTitle.get(key);
    if (existing) return existing;
    const id = generateId();
    this.byTitle.set(key, id);
    this.created.push({ id, databaseId: this.databaseId, values: { [this.titleFieldId]: title } });
    return id;
  }

  takeCreated() {
    const rows = this.created;
    this.created = [];
    return rows;
  }
}

async function loadRows(databaseId: string): Promise<CustomDatabaseRow[]> {
  const snapshot = await getDocs(query(collection(db, 'customDatabaseRows')));
  return snapshot.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomDatabaseRow, 'id'>) }))
    .filter((r) => r.databaseId === databaseId);
}

// Creates the database a fresh import lands in. Its fields come from
// whichever columns were mapped to a new field, in file order; the first of
// them becomes the row title, same as any hand-made database.
export async function createDatabaseForImport(name: string, fields: FieldDef[]): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, 'customDatabases'), {
    name: name || 'Імпорт',
    fields,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

// Writes the mapped rows, in batches, resolving relation columns by name as
// it goes. Returns how many rows landed.
export async function runTableImport(opts: {
  databaseId: string;
  fields: FieldDef[];
  columns: ColumnMapping[];
  dataRows: string[][];
  // Builds the row's name out of several columns joined together, for a
  // table where no single column is unique on its own - a fleet where the
  // model repeats and only model plus plate identifies a vehicle. The
  // columns still become their own fields; only the name is combined.
  compositeTitle?: { fieldId: string; columnIndexes: number[] };
}): Promise<number> {
  const { databaseId, fields, columns, dataRows, compositeTitle } = opts;
  const fieldById = new Map(fields.map((f) => [f.id, f]));

  // Which databases the relation columns point at.
  const relationTargets = new Set(
    columns
      .map((mapping) => {
        const field = mapping.kind === 'skip' ? undefined : fieldById.get(mapping.fieldId);
        return field?.type === 'relation' && field.relationTarget?.kind === 'customDb'
          ? field.relationTarget.databaseId
          : null;
      })
      .filter((id): id is string => !!id)
  );

  // One resolver per target database, primed with whatever is already in
  // it, so two columns pointing at the same database share one cache and
  // can't invent the same row twice. The databases are read once, not once
  // per column.
  const resolvers = new Map<string, RelationResolver>();
  if (relationTargets.size > 0) {
    const databasesSnapshot = await getDocs(query(collection(db, 'customDatabases')));
    for (const targetId of relationTargets) {
      const targetFields = (databasesSnapshot.docs.find((d) => d.id === targetId)?.data() as
        | { fields?: FieldDef[] }
        | undefined)?.fields;
      const titleFieldId = targetFields?.[0]?.id;
      if (!titleFieldId) continue;
      resolvers.set(targetId, new RelationResolver(targetId, titleFieldId, await loadRows(targetId)));
    }
  }

  let written = 0;
  for (let start = 0; start < dataRows.length; start += BATCH_LIMIT) {
    const batch = writeBatch(db);
    const chunk = dataRows.slice(start, start + BATCH_LIMIT);
    for (const rowCells of chunk) {
      const values: Record<string, string | number | string[]> = {};
      columns.forEach((mapping, index) => {
        if (mapping.kind === 'skip') return;
        const field = fieldById.get(mapping.fieldId);
        if (!field) return;
        const cell = (rowCells[index] ?? '').toString().trim();
        if (cell === '') return;
        if (field.type === 'number') {
          const n = Number(cell.replace(',', '.'));
          if (!Number.isNaN(n)) values[field.id] = n;
          return;
        }
        if (field.type === 'date') {
          const key = normalizeDate(cell);
          if (key) values[field.id] = key;
          return;
        }
        if (field.type === 'select' || field.type === 'multiSelect') {
          const labels = field.type === 'multiSelect' ? cell.split(',').map((p) => p.trim()) : [cell];
          const ids = labels
            .map((label) => field.options?.find((o) => o.label.toLowerCase() === label.toLowerCase())?.id)
            .filter((id): id is string => !!id);
          if (ids.length > 0) values[field.id] = field.type === 'multiSelect' ? ids : ids[0];
          return;
        }
        if (field.type === 'relation' && field.relationTarget?.kind === 'customDb') {
          const resolved = resolvers.get(field.relationTarget.databaseId)?.resolve(cell);
          if (resolved) values[field.id] = resolved;
          return;
        }
        values[field.id] = cell;
      });

      if (compositeTitle && compositeTitle.columnIndexes.length > 0) {
        const joined = compositeTitle.columnIndexes
          .map((i) => (rowCells[i] ?? '').toString().trim())
          .filter((part) => part !== '')
          .join(' · ');
        if (joined) values[compositeTitle.fieldId] = joined;
      }

      const now = Date.now();
      batch.set(doc(db, 'customDatabaseRows', generateId()), {
        databaseId,
        values,
        tagIds: [],
        createdAt: now,
        updatedAt: now,
      });
      written += 1;
    }

    // Rows invented by relation resolution ride along in the same batch.
    resolvers.forEach((resolver) => {
      resolver.takeCreated().forEach((created) => {
        const now = Date.now();
        batch.set(doc(db, 'customDatabaseRows', created.id), {
          databaseId: created.databaseId,
          values: created.values,
          tagIds: [],
          createdAt: now,
          updatedAt: now,
        });
      });
    });

    await batch.commit();
  }
  return written;
}

// Builds the option list a 'select'/'multiSelect' column needs, from the
// values actually present in the file - the user never has to pre-declare
// them.
export function optionsFromColumn(values: string[], multi: boolean): { id: string; label: string; color: string }[] {
  const palette = ['#DAA587', '#84B799', '#BE7657', '#69736E', '#A0B4AF', '#556E78', '#788782'];
  const labels = new Set<string>();
  values.forEach((v) => {
    const cell = (v ?? '').trim();
    if (!cell) return;
    (multi ? cell.split(',') : [cell]).forEach((part) => {
      const label = part.trim();
      if (label) labels.add(label);
    });
  });
  return Array.from(labels).map((label, i) => ({
    id: generateId(),
    label,
    color: palette[i % palette.length],
  }));
}
