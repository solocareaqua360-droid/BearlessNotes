import { CustomDatabase, CustomDatabaseRow, FieldDef } from '../types';
import { RowDisplayContext, displayFieldValue, resolveRelationValue, rowTitleOf } from './customRowDisplay';

export type SortDir = 'asc' | 'desc';

// 'title' / 'createdAt' / 'updatedAt' are the built-ins every database
// screen in this app offers; anything else is one of THIS database's own
// field ids. Deliberately a plain string rather than an extension of
// utils/sortItems' closed SortField union - that union is shared with
// five other screens which have no user-defined fields to widen it for.
export type RowSort = { field: string; dir: SortDir };

export const DEFAULT_ROW_SORT: RowSort = { field: 'updatedAt', dir: 'desc' };

export const BUILT_IN_SORT_FIELDS = ['title', 'createdAt', 'updatedAt'] as const;

export const BUILT_IN_SORT_LABELS: Record<string, string> = {
  title: 'Назва',
  createdAt: 'Створено',
  updatedAt: 'Оновлено',
};

// multiSelect is the one type left out: a row holding three options has no
// single position in an ordering, so sorting by it would be arbitrary.
// Filtering by it, on the other hand, works perfectly - see facetsOfRow.
const SORTABLE_TYPES: FieldDef['type'][] = ['text', 'number', 'date', 'select', 'relation'];

// The database's own fields that can be sorted by. fields[0] is skipped
// because it IS the built-in 'title' sort, under the user's own name for
// it - offering both would be the same ordering listed twice.
export function sortableFieldsOf(database: CustomDatabase | null | undefined): FieldDef[] {
  return (database?.fields ?? []).slice(1).filter((f) => !f.hidden && SORTABLE_TYPES.includes(f.type));
}

// Everything past the title can be filtered, whatever its type - even a
// free-text field, since the options offered are the values actually
// present rather than a text box to guess into. The title itself is left
// out on purpose: its facet list would be one entry per row, which is
// what search is for.
export function filterableFieldsOf(database: CustomDatabase | null | undefined): FieldDef[] {
  return (database?.fields ?? []).slice(1).filter((f) => !f.hidden);
}

export function sortLabelFor(sort: RowSort, database: CustomDatabase | null | undefined): string {
  return BUILT_IN_SORT_LABELS[sort.field] ?? database?.fields.find((f) => f.id === sort.field)?.name ?? 'Сортування';
}

// Text and dates read best oldest-first-is-wrong / A→Z; numbers and the
// two timestamps read best biggest-or-newest first.
export function defaultDirFor(field: string, database: CustomDatabase | null | undefined): SortDir {
  if (field === 'title') return 'asc';
  if (field === 'createdAt' || field === 'updatedAt') return 'desc';
  const type = database?.fields.find((f) => f.id === field)?.type;
  return type === 'number' || type === 'date' ? 'desc' : 'asc';
}

// ---------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------

// One field's condition. 'any' matches a row holding at least one of
// `values`; 'filled'/'empty' are the presence checks that no list of
// values can express. Several filters are AND-ed, one per field at most -
// "select is A or B, and date is filled" is the shape this covers.
export type RowFilter = {
  fieldId: string;
  op: 'any' | 'filled' | 'empty';
  values?: string[];
};

// The RAW keys a row holds for a field - option ids for select types, the
// target id for a relation, the stored text/number/dateKey otherwise.
// Keys, not labels: an option renamed later must not silently drop out of
// the filter that selected it.
export function facetsOfRow(field: FieldDef, row: CustomDatabaseRow): string[] {
  const value = row.values[field.id];
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.filter((v) => v !== '');
  return [String(value)];
}

export function facetLabel(field: FieldDef, key: string, ctx: RowDisplayContext): string {
  if (field.type === 'select' || field.type === 'multiSelect') {
    return field.options?.find((o) => o.id === key)?.label ?? 'Без назви';
  }
  if (field.type === 'relation') {
    return resolveRelationValue(field, key, ctx)?.label ?? 'Запис';
  }
  return displayFieldValue(field, key, ctx) || 'Без назви';
}

export type Facet = { key: string; label: string; count: number };

// Every value actually present in `rows` for this field, with how many
// rows hold it. Offering only real values is what makes a filter usable
// without a query language: there is no way to pick a combination that
// returns nothing.
export function facetsOf(field: FieldDef, rows: CustomDatabaseRow[], ctx: RowDisplayContext): Facet[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const key of facetsOfRow(field, row)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const facets = [...counts.entries()].map(([key, count]) => ({ key, label: facetLabel(field, key, ctx), count }));
  // select/multiSelect keep the order the user arranged their options in;
  // everything else has no inherent order, so it goes alphabetically.
  if (field.type === 'select' || field.type === 'multiSelect') {
    const order = new Map((field.options ?? []).map((o, i) => [o.id, i]));
    return facets.sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999));
  }
  return facets.sort((a, b) => a.label.localeCompare(b.label, 'uk', { sensitivity: 'base', numeric: true }));
}

export function activeFilterFor(filters: RowFilter[], fieldId: string): RowFilter | undefined {
  return filters.find((f) => f.fieldId === fieldId);
}

// Adds/removes one value from a field's filter, returning the next filter
// list. A field whose last value is removed drops out entirely rather
// than staying as an empty condition that matches nothing.
export function toggleFacet(filters: RowFilter[], fieldId: string, key: string): RowFilter[] {
  const existing = activeFilterFor(filters, fieldId);
  if (!existing || existing.op !== 'any') {
    return [...filters.filter((f) => f.fieldId !== fieldId), { fieldId, op: 'any', values: [key] }];
  }
  const values = existing.values ?? [];
  const next = values.includes(key) ? values.filter((v) => v !== key) : [...values, key];
  const rest = filters.filter((f) => f.fieldId !== fieldId);
  return next.length === 0 ? rest : [...rest, { fieldId, op: 'any', values: next }];
}

// Tapping the presence op it already has clears the filter, so the same
// row is both the on and the off switch.
export function setPresenceOp(filters: RowFilter[], fieldId: string, op: 'filled' | 'empty'): RowFilter[] {
  const existing = activeFilterFor(filters, fieldId);
  const rest = filters.filter((f) => f.fieldId !== fieldId);
  return existing?.op === op ? rest : [...rest, { fieldId, op }];
}

export function clearFilterFor(filters: RowFilter[], fieldId: string): RowFilter[] {
  return filters.filter((f) => f.fieldId !== fieldId);
}

export function describeFilter(filter: RowFilter, field: FieldDef, ctx: RowDisplayContext): string {
  if (filter.op === 'filled') return `${field.name}: заповнено`;
  if (filter.op === 'empty') return `${field.name}: порожньо`;
  const values = filter.values ?? [];
  if (values.length === 1) return `${field.name}: ${facetLabel(field, values[0], ctx)}`;
  return `${field.name}: ${values.length}`;
}

export function applyRowFilters(
  rows: CustomDatabaseRow[],
  filters: RowFilter[],
  database: CustomDatabase | null | undefined
): CustomDatabaseRow[] {
  if (filters.length === 0) return rows;
  const byId = new Map((database?.fields ?? []).map((f) => [f.id, f]));
  // A filter on a field that has since been deleted is ignored rather
  // than matching nothing - the stored view outlives the schema.
  const live = filters.filter((f) => byId.has(f.fieldId));
  if (live.length === 0) return rows;
  return rows.filter((row) =>
    live.every((filter) => {
      const keys = facetsOfRow(byId.get(filter.fieldId)!, row);
      if (filter.op === 'filled') return keys.length > 0;
      if (filter.op === 'empty') return keys.length === 0;
      return (filter.values ?? []).some((v) => keys.includes(v));
    })
  );
}

// ---------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------

// Rows with no value for the sort field always land at the BOTTOM, in
// both directions - flipping the direction to find the newest shouldn't
// bury every real value under the blanks.
function compareByField(
  a: CustomDatabaseRow,
  b: CustomDatabaseRow,
  field: FieldDef,
  ctx: RowDisplayContext
): number {
  const av = a.values[field.id];
  const bv = b.values[field.id];
  const aEmpty = av === undefined || av === null || av === '';
  const bEmpty = bv === undefined || bv === null || bv === '';
  if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  if (field.type === 'number') return Number(av) - Number(bv);
  // dateKeys are 'YYYY-MM-DD', so plain string order IS date order.
  if (field.type === 'date') return String(av).localeCompare(String(bv));
  if (field.type === 'select') {
    const order = new Map((field.options ?? []).map((o, i) => [o.id, i]));
    return (order.get(String(av)) ?? 999) - (order.get(String(bv)) ?? 999);
  }
  return displayFieldValue(field, av, ctx).localeCompare(displayFieldValue(field, bv, ctx), 'uk', {
    sensitivity: 'base',
    numeric: true,
  });
}

export function sortRows(
  rows: CustomDatabaseRow[],
  sort: RowSort,
  database: CustomDatabase | null | undefined,
  ctx: RowDisplayContext
): CustomDatabaseRow[] {
  const field = database?.fields.find((f) => f.id === sort.field);
  const factor = sort.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    let raw: number;
    if (field) {
      raw = compareByField(a, b, field, ctx);
      // The empties-last sentinel is direction-independent, so it has to
      // escape the factor below.
      if (!Number.isFinite(raw)) return raw > 0 ? 1 : -1;
    } else if (sort.field === 'title') {
      raw = rowTitleOf(database, a).localeCompare(rowTitleOf(database, b), 'uk', {
        sensitivity: 'base',
        numeric: true,
      });
    } else if (sort.field === 'createdAt') {
      // Rows saved before createdAt existed fall back to their own
      // updatedAt rather than sorting as if created at time zero.
      raw = (a.createdAt ?? a.updatedAt) - (b.createdAt ?? b.updatedAt);
    } else {
      raw = a.updatedAt - b.updatedAt;
    }
    return raw * factor;
  });
}

// ---------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------

function sameValues(a: string[] | undefined, b: string[] | undefined): boolean {
  const av = [...(a ?? [])].sort();
  const bv = [...(b ?? [])].sort();
  return av.length === bv.length && av.every((v, i) => v === bv[i]);
}

// Order-independent on both the filter list and each filter's values: two
// filter sets that select the same rows are the same view, however they
// were built up.
export function filtersEqual(a: RowFilter[], b: RowFilter[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((filter) => {
    const other = b.find((f) => f.fieldId === filter.fieldId);
    return !!other && other.op === filter.op && sameValues(filter.values, other.values);
  });
}

// Whether the screen is CURRENTLY showing exactly what a saved view
// describes. Derived rather than stored: the alternative, remembering
// which view was last tapped, goes stale the moment a filter is nudged,
// and then the capsule names a view the screen is no longer showing.
export function viewMatchesState(
  view: { viewMode: string; sortField: string; sortDir: string; filters: RowFilter[] },
  viewMode: string,
  sort: RowSort,
  filters: RowFilter[]
): boolean {
  return (
    view.viewMode === viewMode &&
    view.sortField === sort.field &&
    view.sortDir === sort.dir &&
    filtersEqual(view.filters ?? [], filters)
  );
}

// ---------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------

// Which fields can head a group. The same facet machinery filtering uses
// (facetsOfRow/facetLabel), so a field groupable here is exactly a field
// filterable there - a select's options, a relation's targets, a text or
// number's distinct values.
export function groupableFieldsOf(database: CustomDatabase | null | undefined): FieldDef[] {
  return (database?.fields ?? []).slice(1).filter((f) => !f.hidden && f.type !== 'backlink');
}

export type RowGroup = { key: string; label: string; rows: CustomDatabaseRow[] };

// Rows split into groups by one field's value, already in the order they
// should be shown. A row with nothing in that field lands in a trailing
// "Без значення" group rather than vanishing; a multiSelect row genuinely
// belongs to several groups and appears under each, which is what that
// field type means.
export function groupRows(
  rows: CustomDatabaseRow[],
  field: FieldDef | null,
  ctx: RowDisplayContext
): RowGroup[] {
  if (!field) return [];
  const byKey = new Map<string, CustomDatabaseRow[]>();
  const empty: CustomDatabaseRow[] = [];
  rows.forEach((row) => {
    const keys = facetsOfRow(field, row);
    if (keys.length === 0) {
      empty.push(row);
      return;
    }
    keys.forEach((key) => {
      const list = byKey.get(key) ?? [];
      list.push(row);
      byKey.set(key, list);
    });
  });

  let groups: RowGroup[] = [...byKey.entries()].map(([key, groupRows_]) => ({
    key,
    label: facetLabel(field, key, ctx),
    rows: groupRows_,
  }));

  // select/multiSelect keep the order the options were arranged in; any
  // other field has no inherent order, so alphabetical.
  if (field.type === 'select' || field.type === 'multiSelect') {
    const order = new Map((field.options ?? []).map((o, i) => [o.id, i]));
    groups = groups.sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999));
  } else {
    groups = groups.sort((a, b) => a.label.localeCompare(b.label, 'uk', { sensitivity: 'base', numeric: true }));
  }

  if (empty.length > 0) groups.push({ key: '', label: 'Без значення', rows: empty });
  return groups;
}
