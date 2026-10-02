import { GRID_TILES, WIDE_TILES } from '../constants/databaseTiles';
import { TAG_KIND_CHOICES } from '../constants/tagKinds';
import { useSoft } from '../theme/soft';
import { useDatabaseTiles } from './useDatabaseTiles';

// THE DATABASES A FOLDER CAN LIVE IN, each as its tile on the Бази board
// shows it - its icon (the user's pick where there is one) and colour. One
// list for the folders' canvas (its circles and lines), the folders' list
// (its roots) and a folder's menu («Додати в інші бази»), so the three
// never disagree. `kind` is the tag kind a folder records it under.
export type FolderBase = { kind: string; label: string; icon: string; color: string };

// BRIGHT, on purpose (the user's, 2026-10-02: "тут не важлива стилістика,
// важлива помітність"): the tiles' own colours are muted to sit in the
// theme, and a dozen lines in them could not be told apart. One vivid
// hue per database, the same in every theme; the user's own databases
// take the rest of the wheel in turn.
const VIVID: Record<string, string> = {
  document: '#3B82F6',
  photo: '#EC4899',
  file: '#F59E0B',
  'link-other': '#14B8A6',
  'link-video': '#EF4444',
  'link-geo': '#22C55E',
  board: '#8B5CF6',
  flashcard: '#6366F1',
};
const VIVID_CYCLE = ['#0EA5E9', '#F97316', '#A855F7', '#10B981', '#E11D48', '#84CC16', '#D946EF', '#06B6D4', '#EAB308'];

const TILE_OF_KIND: Record<string, string> = {
  document: 'documents',
  photo: 'photos',
  file: 'files',
  'link-other': 'links',
  'link-video': 'video',
  'link-geo': 'geo',
  board: 'board',
  flashcard: 'flashcards',
};
const TILES = [...WIDE_TILES, ...GRID_TILES];

export function useFolderBases(): FolderBase[] {
  const S = useSoft();
  const { customDatabases, colorFor, iconFor } = useDatabaseTiles();
  return [
    ...TAG_KIND_CHOICES.map((c) => {
      const tileKey = TILE_OF_KIND[c.kind];
      const tile = TILES.find((t) => t.key === tileKey);
      return {
        kind: c.kind,
        label: c.label,
        icon: tile ? iconFor(tile.key, tile.icon) : 'grid-outline',
        color: VIVID[c.kind] ?? (tileKey ? colorFor(tileKey) : S.ink2),
      };
    }),
    ...customDatabases.map((d, i) => ({
      kind: `customRow:${d.id}`,
      label: d.name || 'База',
      icon: d.icon ?? 'grid-outline',
      color: VIVID_CYCLE[i % VIVID_CYCLE.length],
    })),
  ];
}
