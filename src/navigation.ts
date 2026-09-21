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
    // The documents tab, by name - what the documents tile on the board
    // opens, since documents are a tab rather than a root-stack screen.
    // groupId: a group pinned to the board opens the documents already
    // filtered to it, and everything else in that group follows under the
    // rule there (see GroupSections).
    | { screen: 'Документи'; params?: { groupId?: string } }
    | { screen: 'Календар'; params: { jumpToDate: string } }
    | { screen: 'Дошки' }
    // Jumps straight into one board rather than wherever BoardsStack last
    // was - used by the calendar's day-history list to open a board item.
    // React Navigation resolves a doubly-nested `screen`/`params` like this
    // by recursing into BoardsStack itself, no extra plumbing needed there.
    | {
        screen: 'Дошки';
        params: { screen: 'Board'; params: { boardId: string; openDocumentId?: string } };
      };
  // autoFocusTitle: set only right after creating a brand-new document
  // (DocumentsScreen's own addDoc) - focuses the title field and raises the
  // keyboard the instant the editor opens, since a fresh "Без назви"
  // document is always going to be named first. Absent (not just false) on
  // every other navigation to this screen.
  // offerBoard: this note was just made out of another one's blocks,
  // and the offer to put it on a board rides in with it - see the
  // clipping bar in DocumentEditorScreen.
  Editor: { documentId: string; autoFocusTitle?: boolean; offerBoard?: boolean };
  // Same DocumentEditorScreen as `Editor`, registered a second time purely
  // for its App.tsx presentation style (slide-up modal, swipe-down to
  // dismiss) - used when opening a document FROM the board, so editing it
  // feels like staying on the board rather than navigating away to a
  // separate screen.
  EditorModal: { documentId: string; autoFocusTitle?: boolean; offerBoard?: boolean };
  // `focusTaskId` - arriving from a "Проект справ" board card: switches
  // to "Всі" so the task is guaranteed visible regardless of its own
  // project, leaves Kanban if it was on, and opens that task's row
  // expanded.
  Tasks: { focusTaskId?: string } | undefined;
  // «Загальний чат» - the capture inbox read back. What goes IN is the
  // window on the dock's long press; this is the history.
  Chat: undefined;
  // A COPY of the documents list, or of the boards, pushed over the tile
  // board. The tile is a door into the database, the way every other tile
  // is, not a shortcut to its tab - so it opens a screen on top, and back
  // returns to the board. The tab's own instance stays where it was.
  DocumentsCopy: undefined;
  BoardsCopy: undefined;
  // One board, opened FROM the boards copy - the root stack has no Board
  // route of its own, that lives in the tab's nested stack.
  BoardCopy: { boardId: string };
  // Geo/video/other links all live in the one `links` mirror collection
  // (see DocumentEditorScreen's fetchLinkPreview) - this param is what
  // splits LinksScreen's one query into three separate-looking databases.
  Links: { category: 'video' | 'geo' | 'other' };
  Photos: undefined;
  Files: undefined;
  // openStickerId: opened straight from the sticker widget (see App.tsx's
  // deep-link handling) - undefined for reaching the screen normally.
  Stickers: { openStickerId?: string } | undefined;
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
  // Absent -> the menu (list of sections, phone-settings style). A
  // section pushes a SECOND instance of this same screen with its own
  // param, rather than being a separate route - one component, one big
  // shared block of state/logic (Drive, theme, keys...) that would
  // otherwise have to be threaded across five files for no real gain.
  Settings: { section?: 'account' | 'appearance' | 'integrations' | 'about' } | undefined;
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
  // openDocumentId: opened straight into the board's document pane - how
  // a generated document jumps back to the board it came from with itself
  // still on screen.
  Board: { boardId: string; openDocumentId?: string };
};
