import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { doc } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { RootStackParamList } from '../navigation';
import { TAG_COLORS } from '../constants/tags';

// The database menu, in one place: it is drawn twice now - as the tiles on
// the Databases screen and as the grid at the head of the drawer - and the
// two must open the same screens under the same colours.
export type Tile = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  // Set only for the three tiles backed by the one `links` mirror collection
  // (see DocumentEditorScreen's fetchLinkPreview / LinksScreen's categoryOf) -
  // each opens the same screen pre-filtered to its own slice instead of a
  // "Скоро" placeholder.
  linkCategory?: 'video' | 'geo' | 'other';
  // Set for tiles with their own dedicated (paramless) screen.
  route?: 'Photos' | 'Files' | 'Tags' | 'Groups' | 'Diary' | 'Stickers';
  // The board tile - unlike the others, this opens a bottom TAB (see
  // App.tsx's BoardsStack), not a root-stack screen, so it goes through
  // `navigation.navigate('Tabs', { screen: 'Дошки' })` instead of `route`.
  opensBoardsTab?: boolean;
};

// "Справи", the link-backed tiles, "Фото" and "Файли" are real, working
// databases so far (see TasksScreen/LinksScreen/PhotosScreen/FilesScreen) -
// only "нагадування" from PROJECT_BRIEF.md's default-types list is still a
// placeholder, filled in the same way each of the above went from "just a
// block" to a real cross-document list. Colors used to be hardcoded per
// tile here - they're user-editable now (see tileColors below), so this
// list only carries what's NOT a matter of preference: which screen a tile
// opens.
export const WIDE_TILE_KEY = 'tasks';
export const WIDE_TILE_LABEL = 'Справи';
export const WIDE_TILE_ICON: keyof typeof Ionicons.glyphMap = 'checkbox-outline';
export const GRID_TILES: Tile[] = [
  { key: 'geo', label: 'Геоточки', icon: 'location-outline', linkCategory: 'geo' },
  { key: 'links', label: 'Посилання', icon: 'link-outline', linkCategory: 'other' },
  { key: 'photos', label: 'Зображення', icon: 'image-outline', route: 'Photos' },
  { key: 'video', label: 'YouTube / TikTok', icon: 'videocam-outline', linkCategory: 'video' },
  { key: 'files', label: 'Файли', icon: 'document-outline', route: 'Files' },
  { key: 'stickers', label: 'Стікери', icon: 'reader-outline', route: 'Stickers' },
  { key: 'board', label: 'Дошка', icon: 'apps-outline', opensBoardsTab: true },
  { key: 'tags', label: 'Теги', icon: 'pricetag-outline', route: 'Tags' },
  { key: 'groups', label: 'Групи', icon: 'albums-outline', route: 'Groups' },
  { key: 'diary', label: 'Щоденник', icon: 'book-outline', route: 'Diary' },
];

export const tileColorsDoc = doc(db, 'settings', 'databaseTileColors');

// Deterministic starting color per tile (harmonious palette, cycled by
// position) - only used until the user picks their own via the tile's
// "..." menu, at which point Firestore's own value takes over.
export function defaultColorFor(key: string): string {
  const allKeys = [WIDE_TILE_KEY, ...GRID_TILES.map((t) => t.key)];
  const index = allKeys.indexOf(key);
  return TAG_COLORS[index % TAG_COLORS.length];
}

export function openDatabaseTile(
  navigation: NativeStackNavigationProp<RootStackParamList>,
  tile: Tile
) {
  if (tile.linkCategory) {
    navigation.navigate('Links', { category: tile.linkCategory });
  } else if (tile.opensBoardsTab) {
    navigation.navigate('Tabs', { screen: 'Дошки' });
  } else if (tile.route) {
    navigation.navigate(tile.route);
  } else {
    navigation.navigate('Placeholder', { icon: tile.icon, label: 'Скоро' });
  }
}
