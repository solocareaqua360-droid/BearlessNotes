import type { CustomDatabase, CustomDatabaseRow, DbTableSettings, FieldDef } from '../types';
import { applyRowFilters, sortRows } from './customRowQuery';
import { visibleFieldsOf, type RowDisplayContext } from './customRowDisplay';
import { generateId } from './documentBlocks';
import type { Block } from '../types';

// THE TABLE OF A DATABASE'S RECORDS ('dbTable' block): which rows and which columns, from the block's own settings.

export const DB_TABLE_DEFAULT_ROWS = 5;
export const DB_TABLE_DEFAULT_COLUMNS = 5;

// The rows, in order: the condition's (unless the table is hand-picked only), then every record added by hand that the
// condition did not bring, less every one taken out by hand - all in the table's own order.
export function dbTableRows(
  raw: CustomDatabaseRow[],
  s: DbTableSettings,
  database: CustomDatabase | null,
  ctx: RowDisplayContext
): CustomDatabaseRow[] {
  const removed = new Set(s.removed ?? []);
  const byCondition = s.source === 'manual' ? [] : applyRowFilters(raw, s.filters ?? [], database);
  const have = new Set(byCondition.map((r) => r.id));
  const added = new Set(s.added ?? []);
  const extra = raw.filter((r) => added.has(r.id) && !have.has(r.id));
  const rows = [...byCondition, ...extra].filter((r) => !removed.has(r.id));
  return sortRows(rows, { field: s.sortField ?? 'title', dir: s.sortDir ?? 'asc' }, database, ctx);
}

// Where each row came from, for the «⋯» line «за умовою N · додано N · прибрано N».
export function dbTableCounts(raw: CustomDatabaseRow[], s: DbTableSettings, database: CustomDatabase | null) {
  const byCondition = s.source === 'manual' ? [] : applyRowFilters(raw, s.filters ?? [], database);
  const have = new Set(byCondition.map((r) => r.id));
  const live = new Set(raw.map((r) => r.id));
  return {
    condition: byCondition.length,
    added: (s.added ?? []).filter((id) => live.has(id) && !have.has(id)).length,
    removed: (s.removed ?? []).filter((id) => live.has(id)).length,
  };
}

// The columns, in order: the chosen ones that still exist, else the base's first visible fields.
export function dbTableColumns(database: CustomDatabase | null, s: DbTableSettings): FieldDef[] {
  const visible = visibleFieldsOf(database);
  if (!s.columns) return visible.slice(0, DB_TABLE_DEFAULT_COLUMNS);
  const byId = new Map(visible.map((f) => [f.id, f]));
  const chosen = s.columns.map((id) => byId.get(id)).filter((f): f is FieldDef => !!f);
  return chosen.length > 0 ? chosen : visible.slice(0, 1);
}

// A new table block of a base, seeded from a saved view's condition and order when one is picked.
export function blockForDbTable(databaseId: string, seed?: { filters?: DbTableSettings['filters']; sortField?: string; sortDir?: 'asc' | 'desc' }): Block {
  const settings: DbTableSettings = {};
  if (seed?.filters?.length) settings.filters = seed.filters;
  if (seed?.sortField) settings.sortField = seed.sortField;
  if (seed?.sortDir) settings.sortDir = seed.sortDir;
  return { id: generateId(), text: '', type: 'dbTable', dbTableDatabaseId: databaseId, dbTable: settings, createdAt: Date.now() };
}
