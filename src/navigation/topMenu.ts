import type { MenuEntry } from '../components/surfaces/Menu';
import { FIELD_ICONS, FIELD_LABELS, FIELD_ORDER } from '../components/SortMenuRows';
import type { SortPref, SortField } from '../utils/sortItems';

// THE «⋯» ROWS EVERY LIST SHARES (the shared set, 2026-10-12): the view section and the order
// section are built here once, so the Documents screen and the single explorer say the same
// words with the same icons in the same order. A screen adds only what is its own around them.
export type ViewMode = 'list' | 'grid' | 'wide' | 'canvas';

export function viewSection(current: string, change: (mode: ViewMode) => void, modes: ViewMode[] = ['list', 'grid', 'canvas']): MenuEntry[] {
  const all: Record<ViewMode, { label: string; icon: string }> = {
    list: { label: 'Список', icon: 'reorder-four-outline' },
    grid: { label: 'Сітка', icon: 'grid-outline' },
    wide: { label: 'Широкі картки', icon: 'tablet-landscape-outline' },
    canvas: { label: 'Полотно', icon: 'easel-outline' },
  };
  return [
    { kind: 'section', label: 'Вигляд' },
    ...modes.map((m) => ({ label: all[m].label, icon: all[m].icon, checked: current === m, onPress: () => change(m) })),
  ] as MenuEntry[];
}

export function orderSection(pref: SortPref, select: (field: SortField) => void): MenuEntry[] {
  return [
    { kind: 'section', label: 'Порядок' },
    ...FIELD_ORDER.map((field) => ({
      // The one in force says which way it runs; choosing it again turns it round.
      label: pref.field === field ? `${FIELD_LABELS[field]} ${pref.dir === 'asc' ? '↑' : '↓'}` : FIELD_LABELS[field],
      icon: FIELD_ICONS[field],
      checked: pref.field === field,
      onPress: () => select(field),
    })),
  ] as MenuEntry[];
}
