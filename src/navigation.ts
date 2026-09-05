import { Ionicons } from '@expo/vector-icons';

export type RootStackParamList = {
  Tabs: undefined;
  Editor: { documentId: string };
  Tasks: undefined;
  // Geo/video/other links all live in the one `links` mirror collection
  // (see DocumentEditorScreen's fetchLinkPreview) - this param is what
  // splits LinksScreen's one query into three separate-looking databases.
  Links: { category: 'video' | 'geo' | 'other' };
  Placeholder: { icon: keyof typeof Ionicons.glyphMap; label: string };
};
