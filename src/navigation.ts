import { Ionicons } from '@expo/vector-icons';
import { NavigatorScreenParams } from '@react-navigation/native';

// The three floating-island tabs (see FloatingIslandTabBar) - typed so
// DatabaseIslandBar and the island itself can navigate into a specific tab
// by name from screens pushed outside the Tab.Navigator (Files/Photos/
// Links/Tasks).
export type TabParamList = {
  Документи: undefined;
  Календар: undefined;
  Більше: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Editor: { documentId: string };
  Tasks: undefined;
  // Geo/video/other links all live in the one `links` mirror collection
  // (see DocumentEditorScreen's fetchLinkPreview) - this param is what
  // splits LinksScreen's one query into three separate-looking databases.
  Links: { category: 'video' | 'geo' | 'other' };
  Photos: undefined;
  Files: undefined;
  Tags: undefined;
  TagItems: { tagId: string };
  // Pushed from the search icon on DocumentsScreen - no longer a bottom
  // tab (see FloatingIslandTabBar).
  Search: undefined;
  Placeholder: { icon: keyof typeof Ionicons.glyphMap; label: string };
};
