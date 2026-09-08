import { Ionicons } from '@expo/vector-icons';

export type RootStackParamList = {
  // The plain `undefined` shape is how every existing navigate('Tabs')
  // call already works; the other two shapes are for jumping straight to
  // a specific screen inside one of the bottom tabs (React Navigation's
  // nested-navigator pattern: navigate to the stack screen, telling it
  // which tab - and, for Календар, which params that tab screen gets).
  // `{ screen: 'Дошки' }` alone (no nested `screen`/`params` inside it)
  // just switches to that tab and lands wherever its own nested
  // BoardsStack last was - see App.tsx's BoardsStack for why that's
  // enough to satisfy "resume the last open board" with no extra code.
  Tabs: undefined | { screen: 'Календар'; params: { jumpToDate: string } } | { screen: 'Дошки' };
  Editor: { documentId: string };
  // Same DocumentEditorScreen as `Editor`, registered a second time purely
  // for its App.tsx presentation style (slide-up modal, swipe-down to
  // dismiss) - used when opening a document FROM the board, so editing it
  // feels like staying on the board rather than navigating away to a
  // separate screen.
  EditorModal: { documentId: string };
  Tasks: undefined;
  // Geo/video/other links all live in the one `links` mirror collection
  // (see DocumentEditorScreen's fetchLinkPreview) - this param is what
  // splits LinksScreen's one query into three separate-looking databases.
  Links: { category: 'video' | 'geo' | 'other' };
  Photos: undefined;
  Files: undefined;
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

// "Дошки" is its own bottom tab (see App.tsx's BoardsStack) rather than a
// couple of root-stack screens, specifically so switching tabs away and
// back preserves this nested stack's own history - React Navigation does
// that automatically for a tab's nested navigator, which is exactly
// "reopen the last board you were on, unless you'd gone back to the list"
// with no manual "remember the last board id" tracking anywhere.
export type BoardsStackParamList = {
  BoardsList: undefined;
  Board: { boardId: string };
};
