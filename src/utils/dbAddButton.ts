import type { CustomDatabase, CustomDatabaseRow, DbAddButtonSettings, DbTableSettings, FieldDef } from '../types';
import { applyRowFilters, type RowFilter } from './customRowQuery';

// THE ADD BUTTON OF A TABLE (2026-11-03). One setting block (DbTableSettings.addButton) says what the button is called, what a
// new record gets without being asked, and what the little window asks. Nothing here knows about «баги»: it reads the base's
// own fields. What the table's FILTER implies («Тип = баг») is the default for a new record, so a filtered table adds records
// that belong in it.

// Field types the window can ask. A relation is asked only when it points at pictures (the screenshots).
export function askable(field: FieldDef): boolean {
  if (field.type === 'text' || field.type === 'number' || field.type === 'date' || field.type === 'select' || field.type === 'multiSelect') return true;
  return field.type === 'relation' && field.relationTarget?.kind === 'photos';
}

export function titleFieldOf(ab: DbAddButtonSettings | undefined, database: CustomDatabase): FieldDef | undefined {
  return database.fields.find((f) => f.id === ab?.titleField && f.type === 'text') ?? database.fields[0];
}

// What the filter implies: one chosen value of a select / text field.
export function autoDefaults(filters: RowFilter[] | undefined, database: CustomDatabase): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of filters ?? []) {
    const field = database.fields.find((x) => x.id === f.fieldId);
    if (!field || f.op !== 'any' || (f.values ?? []).length !== 1) continue;
    if (field.type === 'select' || field.type === 'text') out[field.id] = f.values![0];
  }
  return out;
}

export function effectiveDefaults(s: DbTableSettings, database: CustomDatabase): Record<string, string> {
  const ab = s.addButton;
  const auto = autoDefaults(s.source === 'manual' ? [] : s.filters, database);
  (ab?.noAuto ?? []).forEach((id) => delete auto[id]);
  const own = Object.fromEntries(Object.entries(ab?.defaults ?? {}).filter(([id]) => database.fields.some((f) => f.id === id)));
  return { ...auto, ...own };
}

export function valueLabel(field: FieldDef, value: string): string {
  if (field.type === 'select') return field.options?.find((o) => o.id === value)?.label ?? value;
  return value;
}

const capital = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

export function addLabel(s: DbTableSettings, database: CustomDatabase): string {
  const given = s.addButton?.label?.trim();
  if (given) return given;
  const defaults = effectiveDefaults(s, database);
  const first = database.fields.find((f) => defaults[f.id] !== undefined && f.type === 'select');
  return first ? capital(valueLabel(first, defaults[first.id])) : 'Новий запис';
}

// The fields the window asks (not the title one, not one the defaults already fill).
export function askedFields(s: DbTableSettings, database: CustomDatabase): FieldDef[] {
  const ab = s.addButton;
  const title = titleFieldOf(ab, database);
  const defaults = effectiveDefaults(s, database);
  return (ab?.ask ?? [])
    .map((id) => database.fields.find((f) => f.id === id))
    .filter((f): f is FieldDef => !!f && f.id !== title?.id && defaults[f.id] === undefined && askable(f));
}

export type AddedValues = Record<string, string | number | string[]>;

// What a new record holds: the defaults, then what was typed and picked.
export function newRowValues(s: DbTableSettings, database: CustomDatabase, typed: string, picked: Record<string, string | string[]>): AddedValues {
  const values: AddedValues = {};
  const defaults = effectiveDefaults(s, database);
  for (const [id, v] of Object.entries(defaults)) {
    const f = database.fields.find((x) => x.id === id);
    values[id] = f?.type === 'multiSelect' ? [v] : v;
  }
  const title = titleFieldOf(s.addButton, database);
  if (title && typed.trim()) values[title.id] = typed.trim();
  for (const f of askedFields(s, database)) {
    const v = picked[f.id];
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (f.type === 'number') {
      const n = Number(String(v).replace(',', '.'));
      if (Number.isFinite(n)) values[f.id] = n;
    } else if (f.type === 'relation') values[f.id] = f.multiple ? (Array.isArray(v) ? v : [v]) : Array.isArray(v) ? v[0] : v;
    else if (f.type === 'multiSelect') values[f.id] = Array.isArray(v) ? v : [v];
    else values[f.id] = v as string;
  }
  return values;
}

// Whether the table (its condition) would show this record: if not, it is also put on the table's «added by hand» list.
export function shownByCondition(s: DbTableSettings, database: CustomDatabase, row: CustomDatabaseRow): boolean {
  if (s.source === 'manual') return false;
  return applyRowFilters([row], (s.filters ?? []) as RowFilter[], database).length === 1;
}

export function recordsWord(n: number): string {
  const t = n % 10;
  const h = n % 100;
  return t === 1 && h !== 11 ? 'запис' : t >= 2 && t <= 4 && (h < 12 || h > 14) ? 'записи' : 'записів';
}
