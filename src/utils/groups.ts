import { Group } from '../types';

// Every database kind a group can be shown in. Groups written before groups
// became multi-kind carry a single `kind` instead of `kinds`, so this reads
// both shapes - which is what lets the change land without a migration pass
// over the whole collection.
export function kindsOf(group: Group): string[] {
  if (group.kinds && group.kinds.length > 0) return group.kinds;
  return group.kind ? [group.kind] : [];
}

// Whether this group belongs in the given database's group tabs. Archived
// groups belong nowhere - they only show on the Groups screen, under
// "Архівні", with their items' groupId untouched so un-archiving brings
// everything back exactly as it was.
export function groupAppliesTo(group: Group, kind: string): boolean {
  if (group.archived) return false;
  return kindsOf(group).includes(kind);
}

// Written on every create/edit so both fields stay in step: `kinds` is the
// real value, `kind` its first entry (see Group.kind on why it's kept).
export function groupKindFields(kinds: string[]): { kinds: string[]; kind: string } {
  return { kinds, kind: kinds[0] ?? '' };
}

// Human-readable name of a database kind, for the Groups screen's "which
// databases see this group" list. A custom database's own name isn't known
// here (it lives in its own document), so the caller passes those in.
export function labelForKind(kind: string, customDatabaseNames: Record<string, string>): string {
  if (kind.startsWith('customRow:')) {
    const id = kind.slice('customRow:'.length);
    return customDatabaseNames[id] ?? 'Власна база';
  }
  const fixed: Record<string, string> = {
    document: 'Документи',
    photo: 'Фото',
    file: 'Файли',
    'link-video': 'YouTube / TikTok',
    'link-geo': 'Геоточки',
    'link-other': 'Посилання',
    task: 'Справи',
    // Not a real group kind (groups don't apply to plain shared text) -
    // included here anyway so addItemToBoard.ts's single-item board add
    // can label a text card's column through this same lookup.
    text: 'Текст',
  };
  return fixed[kind] ?? kind;
}
