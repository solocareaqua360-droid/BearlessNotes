import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

export type BlockAction =
  | 'bulleted'
  | 'numbered'
  | 'checkbox'
  | 'divider'
  | 'image'
  | 'camera'
  | 'file'
  | 'scan'
  | 'sketch'
  | 'table'
  | 'existing';

// Ionicons has no numbered-list glyph at all (only "list"/"list-circle"),
// so bulleted and numbered used to share the very same icon - fine while
// each had a label under it, useless the moment the toolbar became icons
// only. Both list types come from MaterialCommunityIcons instead, so they
// read as a matched pair rather than one Ionicons icon next to a stranger.
export type BlockActionEntry =
  | { key: BlockAction; family: 'ionicons'; icon: keyof typeof Ionicons.glyphMap; label: string }
  | {
      key: BlockAction;
      family: 'material-community';
      icon: keyof typeof MaterialCommunityIcons.glyphMap;
      label: string;
    };

// One list, two renderings: the toolbar row shows just the icon (labels
// are what makes an icons-only bar unreadable, so they move to the sheet),
// and the "+" sheet shows icon + label together. Keeping both off the same
// array is what stops the two from drifting apart as block types are added.
export const BLOCK_ACTIONS: BlockActionEntry[] = [
  { key: 'bulleted', family: 'material-community', icon: 'format-list-bulleted', label: 'Список' },
  { key: 'numbered', family: 'material-community', icon: 'format-list-numbered', label: 'Нумерований список' },
  { key: 'checkbox', family: 'ionicons', icon: 'checkbox-outline', label: 'Чекбокс' },
  { key: 'divider', family: 'ionicons', icon: 'remove-outline', label: 'Лінія' },
  { key: 'image', family: 'ionicons', icon: 'image-outline', label: 'Зображення' },
  { key: 'camera', family: 'ionicons', icon: 'camera-outline', label: 'Камера' },
  { key: 'file', family: 'ionicons', icon: 'document-outline', label: 'Файл' },
  { key: 'scan', family: 'ionicons', icon: 'scan-outline', label: 'Сканувати' },
  { key: 'sketch', family: 'ionicons', icon: 'brush-outline', label: 'Малюнок' },
  { key: 'table', family: 'ionicons', icon: 'grid-outline', label: 'Таблиця' },
  { key: 'existing', family: 'ionicons', icon: 'search-outline', label: 'З бази даних' },
];

// Both renderings (bar and sheet) draw icons through this, so neither has
// to know or switch on which family an entry came from.
export function BlockActionIcon({ entry, size, color }: { entry: BlockActionEntry; size: number; color: string }) {
  if (entry.family === 'material-community') {
    return <MaterialCommunityIcons name={entry.icon} size={size} color={color} />;
  }
  return <Ionicons name={entry.icon} size={size} color={color} />;
}
