import { CustomDatabase, CustomDatabaseRow, FieldDef } from '../types';

// Everything a custom-database row needs in order to be rendered anywhere
// outside its own screen: the Photos a 'relation' field can point at, plus
// the field defs and rows of whichever OTHER databases its relation fields
// reference. CustomDatabaseScreen already holds all three as live state;
// useCustomRowData subscribes to the same three for a single row embedded
// in a document. Missing entries are never an error - they just resolve to
// a neutral label, which is what an offline/not-yet-loaded target looks
// like too.
export type RowDisplayContext = {
  photos: { id: string; imageUri: string; title?: string; driveFileId?: string }[];
  relatedDatabases: Record<string, CustomDatabase>;
  relatedRows: Record<string, CustomDatabaseRow[]>;
};

export type ResolvedRelation = { label: string; thumbUri?: string; driveFileId?: string };

export const EMPTY_ROW_DISPLAY_CONTEXT: RowDisplayContext = {
  photos: [],
  relatedDatabases: {},
  relatedRows: {},
};

// A database's cover field, if it has one - the single 'relation' field
// marked isCover, whose target renders as a thumbnail instead of text.
export function coverFieldOf(database: CustomDatabase | null | undefined): FieldDef | null {
  const cover = database?.fields.find((f) => f.type === 'relation' && f.isCover);
  // A hidden cover field hides its thumbnail too - "приховати" means
  // everywhere, and a card with no cover simply falls back to text.
  return cover && !cover.hidden ? cover : null;
}

// The fields a VIEW should draw, in order. The row form deliberately does
// NOT use this: hiding a field must not make it impossible to give it a
// value.
export function visibleFieldsOf(database: CustomDatabase | null | undefined): FieldDef[] {
  return (database?.fields ?? []).filter((f) => !f.hidden);
}

export function rowTitleOf(database: CustomDatabase | null | undefined, row: CustomDatabaseRow | null | undefined): string {
  const titleFieldId = database?.fields[0]?.id;
  if (!row || !titleFieldId) return 'Без назви';
  return String(row.values[titleFieldId] ?? '').trim() || 'Без назви';
}

// What a relation field's stored target id (row.values[field.id]) should
// show - a label, and a thumbnail when one is available. A 'customDb'
// target is resolved one level further, into its OWN cover, so a
// relation-to-a-relation still surfaces a real photo rather than just a
// name; deliberately no deeper than that one extra hop.
export function resolveRelationValue(
  field: FieldDef,
  targetId: string | undefined,
  ctx: RowDisplayContext
): ResolvedRelation | null {
  if (!targetId) return null;
  const target = field.relationTarget;
  if (!target || target.kind === 'photos') {
    const photo = ctx.photos.find((p) => p.id === targetId);
    if (!photo) return { label: 'Фото' };
    return { label: photo.title || 'Фото', thumbUri: photo.imageUri, driveFileId: photo.driveFileId };
  }
  const targetDb = ctx.relatedDatabases[target.databaseId];
  const targetRow = ctx.relatedRows[target.databaseId]?.find((r) => r.id === targetId);
  if (!targetDb || !targetRow) return { label: 'Запис' };
  const label = rowTitleOf(targetDb, targetRow);
  const targetCoverField = coverFieldOf(targetDb);
  if (targetCoverField?.relationTarget?.kind === 'photos') {
    const coverTargetId = targetRow.values[targetCoverField.id];
    if (typeof coverTargetId === 'string') {
      const photo = ctx.photos.find((p) => p.id === coverTargetId);
      if (photo) return { label, thumbUri: photo.imageUri, driveFileId: photo.driveFileId };
    }
  }
  return { label };
}

// One field's value as display text - '' for an empty one, which is what
// callers filter on to decide whether it's worth showing at all.
export function displayFieldValue(
  field: FieldDef,
  value: string | number | string[] | undefined,
  ctx: RowDisplayContext
): string {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'date' && typeof value === 'string') {
    // Already a dateKey ("YYYY-MM-DD") - just reformat, no Date round-trip.
    return value.split('-').reverse().join('.');
  }
  if ((field.type === 'select' || field.type === 'multiSelect') && field.options) {
    const ids = Array.isArray(value) ? value : [value as string];
    return ids
      .map((id) => field.options?.find((o) => o.id === id)?.label)
      .filter(Boolean)
      .join(', ');
  }
  if (field.type === 'relation' && typeof value === 'string') {
    return resolveRelationValue(field, value, ctx)?.label ?? '';
  }
  return String(value);
}

export type RowDisplay = {
  title: string;
  // null when the database has a cover field but this row hasn't picked
  // one; undefined when the database has no cover field at all - the card
  // draws a placeholder for the first and nothing for the second.
  cover: ResolvedRelation | null | undefined;
  // Every filled field past the title, except the cover (which is already
  // the thumbnail) - the card shows these as type-icon + value.
  chips: { field: FieldDef; shown: string }[];
};

export function buildRowDisplay(
  database: CustomDatabase | null | undefined,
  row: CustomDatabaseRow | null | undefined,
  ctx: RowDisplayContext
): RowDisplay {
  if (!database || !row) return { title: rowTitleOf(database, row), cover: undefined, chips: [] };
  const cover = coverFieldOf(database);
  const coverRaw = cover ? row.values[cover.id] : undefined;
  return {
    title: rowTitleOf(database, row),
    cover: !cover ? undefined : typeof coverRaw === 'string' ? resolveRelationValue(cover, coverRaw, ctx) : null,
    chips: database.fields
      .slice(1)
      .filter((f) => !f.hidden && f.id !== cover?.id)
      .map((f) => ({ field: f, shown: displayFieldValue(f, row.values[f.id], ctx) }))
      .filter((entry) => entry.shown !== ''),
  };
}
