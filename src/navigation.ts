import { Ionicons } from '@expo/vector-icons';

export type RootStackParamList = {
  Tabs: undefined;
  Editor: { documentId: string };
  Tasks: undefined;
  Links: undefined;
  Placeholder: { icon: keyof typeof Ionicons.glyphMap; label: string };
};
