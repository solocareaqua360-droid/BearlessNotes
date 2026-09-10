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
  Tabs:
    | undefined
    | { screen: 'Календар'; params: { jumpToDate: string } }
    | { screen: 'Дошки' }
    // Jumps straight into one board rather than wherever BoardsStack last
    // was - used by the calendar's day-history list to open a board item.
    // React Navigation resolves a doubly-nested `screen`/`params` like this
    // by recursing into BoardsStack itself, no extra plumbing needed there.
    | { screen: 'Дошки'; params: { screen: 'Board'; params: { boardId: string } } };
  // autoFocusTitle: set only right after creating a brand-new document
  // (DocumentsScreen's own addDoc) - focuses the title field and raises the
  // keyboard the instant the editor opens, since a fresh "Без назви"
  // document is always going to be named first. Absent (not just false) on
  // every other navigation to this screen.
  Editor: { documentId: string; autoFocusTitle?: boolean };
  // Same DocumentEditorScreen as `Editor`, registered a second time purely
  // for its App.tsx presentation style (slide-up modal, swipe-down to
  // dismiss) - used when opening a document FROM the board, so editing it
  // feels like staying on the board rather than navigating away to a
  // separate screen.
  EditorModal: { documentId: string; autoFocusTitle?: boolean };
  Tasks: undefined;
  // Geo/video/other links all live in the one `links` mirror collection
  // (see DocumentEditorScreen's fetchLinkPreview) - this param is what
  // splits LinksScreen's one query into three separate-looking databases.
  Links: { category: 'video' | 'geo' | 'other' };
  Photos: undefined;
  Files: undefined;
  Stickers: undefined;
  // A user-created database (DatabasesScreen's dynamic tiles, one per
  // Firestore doc in `customDatabases`) - unlike Photos/Files/Stickers,
  // there's no fixed number of these, so one shared screen keyed by id
  // instead of one RootStackParamList entry per database.
  // openRowId: set only when arriving from a 'dbRow' block in a document -
  // the screen opens that row's editor as soon as its rows have loaded, so
  // the tap lands on the record itself rather than just its database.
  CustomDatabase: { databaseId: string; openRowId?: string; openViewId?: string };
  Tags: undefined;
  // The temporary, cross-database counterpart to Tags (see the Group type).
  Groups: undefined;
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
