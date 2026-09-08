import { Ionicons } from '@expo/vector-icons';

export type RootStackParamList = {
  // The plain `undefined` shape is how every existing navigate('Tabs')
  // call already works; the second shape is only for jumping straight to
  // a specific day from DiaryScreen (React Navigation's nested-navigator
  // pattern: navigate to the stack screen, telling it which tab and which
  // params that tab screen gets).
  Tabs: undefined | { screen: 'Календар'; params: { jumpToDate: string } };
  Editor: { documentId: string };
  Tasks: undefined;
  // Geo/video/other links all live in the one `links` mirror collection
  // (see DocumentEditorScreen's fetchLinkPreview) - this param is what
  // splits LinksScreen's one query into three separate-looking databases.
  Links: { category: 'video' | 'geo' | 'other' };
  Photos: undefined;
  Files: undefined;
  BoardsList: undefined;
  Board: { boardId: string };
  Tags: undefined;
  TagItems: { tagId: string };
  Settings: undefined;
  // Pushed from the search icon on DocumentsScreen - no longer a bottom
  // tab (see FloatingIslandTabBar).
  Search: undefined;
  // "Щоденник" - calendar sheets that have real content, searchable by
  // their own text and by the names of any photo/file/link embedded in
  // them.
  Diary: undefined;
  Placeholder: { icon: keyof typeof Ionicons.glyphMap; label: string };
};
