import { GRID_TILES, WIDE_TILES } from '../constants/databaseTiles';
import { TAG_KIND_CHOICES } from '../constants/tagKinds';
import { useRecordColour } from '../theme/ThemeProvider';
import { useSoft } from '../theme/soft';
import { useDatabaseTiles } from './useDatabaseTiles';

// THE DATABASES A FOLDER CAN LIVE IN, each as its tile on the Бази board
// shows it - its icon (the user's pick where there is one) and colour. One
// list for the folders' canvas (its circles and lines), the folders' list
// (its roots) and a folder's menu («Додати в інші бази»), so the three
// never disagree. `kind` is the tag kind a folder records it under.
export type FolderBase = { kind: string; label: string; icon: string; color: string };

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
  const recordColour = useRecordColour();
  return [
    ...TAG_KIND_CHOICES.map((c) => {
      const tileKey = TILE_OF_KIND[c.kind];
      const tile = TILES.find((t) => t.key === tileKey);
      return {
        kind: c.kind,
        label: c.label,
        icon: tile ? iconFor(tile.key, tile.icon) : 'grid-outline',
        color: tileKey ? colorFor(tileKey) : S.ink2,
      };
    }),
    ...customDatabases.map((d) => ({
      kind: `customRow:${d.id}`,
      label: d.name || 'База',
      icon: d.icon ?? 'grid-outline',
      color: d.color ?? recordColour(d.id).background,
    })),
  ];
}
