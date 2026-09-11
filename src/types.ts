export type BlockType =
  | 'paragraph'
  | 'bulleted'
  | 'numbered'
  | 'checkbox'
  | 'divider'
  | 'image'
  | 'file'
  | 'link'
  | 'sketch'
  | 'table'
  // A row of a user-created database (CustomDatabaseRow), embedded as a
  // card. Unlike every other reference block here, this one renders LIVE
  // rather than from a snapshot - editing the row in its own database
  // updates every document that mentions it, which is the two-way link
  // PROJECT_BRIEF.md asks for.
  | 'dbRow'
  // A saved view of a user-created database (CustomDatabaseView), embedded
  // as a live-filtered, live-sorted slice of its rows - same two-way link
  // as 'dbRow', one level up: the block shows whichever rows currently
  // match the view's filter, not a fixed list picked at insert time.
  | 'dbView';

// One freehand stroke OR simple shape (line/rectangle/circle) in a
// 'sketch' block - `d` is a plain SVG path `d` attribute. A freehand
// stroke builds it up point-by-point while drawing; a shape computes it
// directly from its start/end points (a rectangle as a closed 4-point
// path, a circle as two arcs) - either way it's just a path to render,
// no separate shape-kind field needed.
// The two defining points of a simple shape, kept alongside the rendered
// path so the shape can still be moved/resized later - a freehand pen
// stroke has no such structure and is deliberately not movable.
export interface SketchShape {
  kind: 'line' | 'arrow' | 'rect' | 'circle';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SketchPathElement {
  kind: 'path';
  d: string;
  color: string;
  width: number;
  // Absent on freehand strokes, and dropped from a shape the eraser has
  // partly rubbed out (it's no longer a clean rectangle/circle).
  shape?: SketchShape;
}

// A text label placed on a 'sketch' block's canvas.
export interface SketchTextElement {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

// A single drawn/placed thing on a 'sketch' block's canvas, in the order
// it was added - one flat, ordered list (rather than separate arrays per
// kind) so "undo" and z-order (a later element drawn on top of an
// earlier one) both just mean "look at the last item".
export type SketchElement = SketchPathElement | SketchTextElement;

export interface Block {
  id: string;
  text: string;
  // Absent/undefined means 'paragraph' - keeps every block already saved in
  // Firestore before block types existed valid without a migration.
  type?: BlockType;
  // Set once, at creation (see buildBlock), and carried forward untouched by
  // every later edit/type-conversion since it's just a spread of the
  // existing block. Threaded into the tasks/links/photos/files mirror docs
  // so those screens' "Дата створення" sort has a real value instead of
  // falling back to updatedAt - absent on any block saved before this field
  // existed, which is exactly when that fallback kicks in.
  createdAt?: number;
  // 'paragraph'/'image'/'sketch' blocks only - set once, when the block is
  // inserted from an existing sticker (see blockFromSticker in
  // copyToNote.ts), never touched again. A sticker reuses these three
  // ordinary block types for its own content rather than needing a
  // dedicated BlockType (a sticker can never nest inside another sticker,
  // so there's nothing a fifth type would buy here) - this flag is what
  // lets syncStickersForDocument tell "this block came from a sticker"
  // apart from an ordinary paragraph/image/sketch block, and what tells
  // the block renderer to keep the sticker's yellow background even once
  // it's embedded in a document.
  isSticker?: boolean;
  checked?: boolean; // 'checkbox' blocks only
  imageUri?: string; // 'image' blocks only
  // 'image' blocks only - set once at creation, never touched again.
  // 'camera' is what routes a genuinely new photo into the fixed "Фото"
  // group in PhotosScreen (see syncPhotosForDocument) - absent (a gallery
  // pick, or any image block from before this existed) leaves the group
  // unassigned as before.
  imageSource?: 'camera';
  // 'image' blocks only. Absent means 'contain' (real proportions, pale
  // gray letterboxing) - keeps images saved before this setting existed
  // displaying the same as they already did.
  imageFit?: 'contain' | 'cover';
  // 'image'/'file' blocks only. Not written by the normal attach flow
  // (Drive backup fills these in asynchronously after upload, on the
  // Firestore mirror record only) - present on a Block only when
  // referencing an EXISTING already-backed-up photo/file from another
  // document (see blockFromFile/blockFromPhoto in copyToNote.ts), so
  // syncFilesForDocument/syncPhotosForDocument know not to upload a
  // duplicate.
  driveFileId?: string;
  driveBytes?: number;
  // 'image' blocks only - a user-given name, always renamable (see
  // PhotosScreen). Absent until the user names it; the photo grid falls
  // back to a generic "Без назви" label, never the raw local file path.
  imageTitle?: string;
  // 'file' blocks only. The URI is a local device path (the file picker's
  // own cache copy) - there's no cloud upload yet, so a file block only
  // opens correctly on the device it was attached from.
  fileUri?: string;
  fileName?: string;
  mimeType?: string;
  // 'file' blocks only - an optional rename that overrides fileName for
  // display (see FilesScreen) without touching the actual attached file.
  fileTitle?: string;
  // 'dbRow' blocks only. The block's own `id` IS the referenced row's id
  // (same convention file/image blocks follow with their record), so this
  // only has to carry which database that row lives in. dbRowTitle is a
  // snapshot used purely as a fallback label while the live row loads, or
  // if it has since been deleted from its database.
  dbRowDatabaseId?: string;
  dbRowTitle?: string;
  // 'dbView' blocks only. Same convention as 'dbRow' above - the block's
  // own `id` IS the referenced view's id, so this only carries which
  // database the view belongs to (needed before the view doc itself has
  // loaded) and a fallback name for while it loads or after it's deleted.
  dbViewDatabaseId?: string;
  dbViewTitle?: string;
  // 'checkbox' blocks only - standard properties of the "справа" object
  // type (hardcoded, unlike a future user-defined type's properties).
  projectId?: string; // references a doc in the 'projects' collection
  // YYYY-MM-DD of the day it was marked "Сьогодні" - a mismatch with the
  // current date means "not today" without needing an active daily reset.
  todayMarkedDate?: string;
  // Which Kanban column a task sits in - unset means "Вхідні" (the first
  // column), so existing tasks don't need a migration. Only meaningful for
  // starred (todayMarkedDate === today) tasks - Kanban only ever shows
  // those.
  kanbanStatus?: 'inbox' | 'inProgress' | 'paused' | 'done';
  // 'checkbox' blocks only - a richer, optional alternative to just
  // todayMarkedDate: a specific due date, and optionally a time that
  // schedules a local notification (see utils/reminders.ts). Setting this
  // to today's date also sets todayMarkedDate to today (the star shows);
  // removing the star clears all three of these instead of only
  // todayMarkedDate, per TasksScreen's toggleToday.
  reminderDate?: string; // YYYY-MM-DD
  reminderTime?: string; // HH:mm, local time - absent means date-only, no notification
  reminderNotificationId?: string; // expo-notifications id, to cancel/reschedule
  // 'link' blocks only - a paragraph containing a bare URL auto-converts
  // into one of these. text holds the original URL. Preview fields are
  // best-effort (fetched once at conversion time) and absent when nothing
  // could be fetched, in which case the block renders as a compact
  // icon-only card instead of erroring or staying plain text.
  linkUrl?: string;
  linkTitle?: string;
  linkImageUrl?: string;
  linkSiteName?: string;
  // 'sketch' blocks only. Elements are kept as vector data (not a
  // flattened image) specifically so the drawing can be reopened and
  // continued, the way Google Keep's drawings work. sketchWidth/
  // sketchHeight are the canvas size the elements' coordinates were
  // captured against - the editor and the inline preview both use that
  // as the SVG viewBox so a drawing still scales correctly if reopened
  // on a different screen size.
  sketchElements?: SketchElement[];
  sketchWidth?: number;
  sketchHeight?: number;
  // 'table' blocks only. tableRows[r].cells[c] is that cell's raw text -
  // either a plain value or a formula starting with "=" (e.g.
  // "=SUM(B1:B3)", referencing other cells by their A1-style address).
  // Wrapped in a {cells} object rather than a plain string[][] because
  // Firestore rejects arrays nested directly inside arrays. Formulas are
  // evaluated at render time (never stored), so a result can never go
  // stale against edited cells.
  tableRows?: TableRow[];
}

export interface TableRow {
  cells: string[];
}

export interface Project {
  id: string;
  name: string;
  color: string;
}

// Same shape as Project, but a deliberately separate concept and Firestore
// collection ("групування", not "проєкт") - Files/Photos/Links group into
// these, Tasks' own projects stay theirs, and the two are never meant to
// mix even though a Group and a Project look identical on paper. `kind`
// additionally scopes a group to the one database it was created in - a
// group made in Photos must never show up as an option in Files or Links.
// Links split into their own video/geo/other kinds, same as TaggableKind
// does for tags and for the same reason: a video's groups and a geo
// point's groups are different vocabularies in practice.
// A group is the app's TEMPORARY, cross-database theme - "what I'm living
// with right now" - as opposed to a tag, which is the permanent library
// (a tree, hundreds of them, one item filed in several places at once). A
// group gathers on the order of a hundred items of mixed types for as long
// as that period lasts, and is archived once it's over, its contents by
// then filed away with tags. That difference is why both exist.
export interface Group {
  id: string;
  name: string;
  color: string;
  // Which databases this group shows up in - 'document' | 'photo' | 'file'
  // | 'link-*' | `customRow:${databaseId}`. A group used to belong to
  // exactly ONE of them (the `kind` field below); it can now span several,
  // which is what lets one theme collect items of different types.
  //
  // Read through groupAppliesTo (utils/groups.ts), never directly: groups
  // written before this existed still carry only `kind`, and that helper is
  // what keeps them working without a migration pass over the collection.
  kinds?: string[];
  // Legacy single-kind form. Still written alongside `kinds` (as its first
  // entry) so a build without this change would keep showing the group in
  // the database it was made in rather than losing it entirely.
  kind?: string;
  // An archived group drops out of every database's group tabs but keeps
  // its items' groupId, so archiving is reversible and nothing is lost -
  // it stays visible under "Архівні" on the Groups screen.
  archived?: boolean;
}

// A database-object kind a tag can be attached to. Used both as the second
// half of a `usedIn` key ("file:abc123") and as an entry in a tag's
// cumulative `types` list.
//
// The 'link' kind is split into 'link-video'/'link-geo'/'link-other' even
// though all three live in the one `links` Firestore collection (see
// LinksScreen's categoryOf) - a video's tags and a geo point's tags are
// different vocabularies in practice, so useTags.isTagAllowedForKind keeps
// their suggestion pools from mixing, unlike file/photo/link which freely
// cross-tag by design.
// Widened to `string` (was a closed union of the six literals below) so a
// custom database can mint its own per-database kind (`customRow:${id}`) -
// every existing call site already just threads this through as a plain
// string, nothing structural relied on the closed set:
// 'file' | 'photo' | 'link-video' | 'link-geo' | 'link-other' | 'document'.
export type TaggableKind = string;

export interface Tag {
  id: string;
  // Full "/"-nested path, e.g. "робота/оренда" - the "/" is what makes it
  // render as a folder in the tree view, with no separate folder entity.
  path: string;
  icon: string; // an Ionicons glyph name
  color: string;
  // Every kind this tag has ever been attached to. Cumulative only - never
  // shrinks when a tag is detached from an item of some kind, since a tag
  // that already spans multiple kinds shouldn't un-list one just because
  // this particular item stopped using it.
  types: TaggableKind[];
  // Reverse index of everything currently tagged, keyed "`${kind}:${id}`".
  // A tag only exists while this has at least one key - see useTags.
  usedIn: Record<string, true>;
}

// A card on a 'Дошка' (board) canvas. Deliberately just a `Block` (the same
// type/text/imageUri/fileUri/linkUrl/etc. fields DocumentEditorScreen's
// blocks already use) plus placement - a card referencing an existing file/
// photo/link is produced by the exact same blockFromFile/blockFromPhoto/
// blockFromLink helpers a document block is (see utils/copyToNote.ts), so a
// future "convert cluster to document" only has to strip x/y/width/color and
// use the result as-is for a new document's `blocks`.
//
// `type` widens BlockType with 'document' rather than adding 'document' to
// BlockType itself - a card can reference a whole other document (opens it
// in the real editor on tap), but a document can never nest as a block
// INSIDE another document, so that fifth type only ever makes sense here on
// the board, never in DocumentEditorScreen's own block list.
export interface BoardCard extends Omit<Block, 'type'> {
  type?: BlockType | 'document';
  x: number;
  y: number;
  width: number;
  // 'paragraph' (sticky-note) cards only - no other Block usage in the app
  // has a per-block color, so this lives here rather than on Block itself.
  color?: string;
  // 'document' cards only - the referenced doc's id (Editor screen param)
  // and a cached title for display, snapshotted at add-time same as every
  // other reference card's display fields (fileTitle/imageTitle/linkTitle).
  documentId?: string;
  documentTitle?: string;
  // 'document' cards only - a snapshot (at add-time, not live) of the
  // document's full text and the first image block's uri, so the card can
  // show a real preview - clipped to 4 lines while collapsed, shown in
  // full while expanded - without re-fetching the document on every
  // render. Absent means an empty/text-free/image-free document.
  documentPreviewText?: string;
  documentPreviewImageUri?: string;
  // Set while the card sits in a kanban column (see BoardColumn) - the
  // card's x/y are then owned by that column's own stacking rather than by
  // wherever it was last dropped, and are recomputed whenever the column's
  // contents change. Cleared by dragging the card out of every column.
  columnId?: string;
  // 'document' cards only - toggled by tapping the card; persisted like
  // any other card field so a board reopens with the same cards expanded.
  // Pan-to-drag is disabled while expanded (see BoardScreen) rather than
  // adding scroll-vs-drag gesture arbitration for potentially very long
  // text - a card can't be dragged while open, only while collapsed.
  documentExpanded?: boolean;
}

// A mindmap-style link between two board cards. Which SIDE of each card the
// line attaches to is deliberately NOT stored - it's derived from where the
// two cards currently sit (the line always leaves the source on the side
// facing the target), so dragging a card to the other side of its partner
// re-routes the line instead of leaving it crossing back over itself.
export interface BoardConnection {
  id: string;
  fromCardId: string;
  toCardId: string;
}

// A kanban lane on the board. Cards dropped inside one stop floating
// freely and stack down it in order (see BoardCard's columnId); dragging a
// card back out releases it. Columns live on the same infinite canvas as
// everything else, so `x`/`y` are plain world coordinates - set when the
// column is created (each new one lands to the right of the last), not yet
// draggable the way a card is.
export interface BoardColumn {
  id: string;
  title: string;
  x: number;
  y: number;
  // Which kind of item this column collects (see utils/groups.ts'
  // kindsOf/labelForKind for the vocabulary) - set only on a column
  // created by addItemToBoard.ts's single-item "add to board" flow, so a
  // second item of the same kind can find and reuse it by kind rather
  // than by title (title is just a label and the user may rename it).
  // Columns from importGroupToBoard.ts don't set this - a fresh column
  // per import batch is the point there, never reused across imports.
  kind?: string;
}

export interface BoardItem {
  id: string;
  title: string;
  cards: BoardCard[];
  connections?: BoardConnection[];
  columns?: BoardColumn[];
  createdAt: number;
  updatedAt: number;
}

export interface DocumentItem {
  id: string;
  title: string;
  updatedAt: number;
  blocks?: Block[];
  tagIds?: string[];
  // Present only on a daily-note document created from the Calendar screen
  // ("YYYY-MM-DD", local time) - DocumentsScreen and SearchScreen both
  // exclude any document carrying this field, so daily notes never leak
  // into the regular document list.
  calendarDate?: string;
  // References a doc in the 'groups' collection (kind: 'document') - same
  // one-group-at-a-time pattern as Files/Photos/Links, a separate
  // namespace from theirs via that kind.
  groupId?: string;
  // Absent on any document created before the sort-by-creation-date feature
  // shipped - see utils/sortItems.ts's fallback-to-updatedAt behavior.
  createdAt?: number;
  // Set via the editor's own "..." menu (DocumentEditorScreen) - takes
  // priority over any image block as the document's card thumbnail (see
  // extractPreview's own coverImageUri parameter).
  coverImageUri?: string;
}

// A user-created database (CustomDatabaseScreen), Notion-style: the user
// defines its own fields rather than picking from this app's fixed set
// (Tasks/Links/Photos/Files). fields[0] is always type 'text' and acts as
// the row's title everywhere (list view, row picker) - it can be renamed
// but never removed or retyped.
export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'multiSelect'
  | 'relation'
  // A heading in the field list, with no value of its own: everything
  // after it, until the next one, reads as belonging to it. Grouping the
  // fields IS the field order, so no separate layout description has to be
  // kept in step with the schema. Shown on the record page and in the row
  // form; ignored by every list/table/filter/sort/group, which are about
  // values and a section has none.
  | 'section'
  // The other end of somebody else's 'relation' field: every row of THAT
  // database currently pointing at this one. Deliberately stores nothing
  // in a row's own `values` - it is computed at render time from rows that
  // are already loaded, which is what makes it impossible for the two
  // sides to disagree, and what makes turning it off again free (nothing
  // was ever written to clean up).
  //
  // It is still editable: adding from this side writes the relation field
  // of the OTHER row, since that single field remains the only place the
  // link is stored.
  | 'backlink';

export interface FieldOption {
  id: string;
  label: string;
  color: string;
}

// What a 'relation' field points at - the built-in Photos database, or
// another user-created one. A row's value for such a field is just the
// target's id as a plain string (CustomDatabaseRow.values already allows a
// string there, same shape 'select' already uses for its one chosen
// FieldOption.id - no new value shape needed).
export type RelationTarget = { kind: 'photos' } | { kind: 'customDb'; databaseId: string };

export interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
  // 'select'/'multiSelect' only.
  options?: FieldOption[];
  // 'relation' only.
  relationTarget?: RelationTarget;
  // 'backlink' only - which database's rows to look at, and which of its
  // 'relation' fields has to point back here for a row to count. Created
  // and removed by the relation field's own "показувати з іншого боку"
  // toggle (see FieldsEditorSheet), never picked as a field type by hand.
  backlinkSource?: { databaseId: string; fieldId: string };
  // 'relation' only - marks this as THE field whose value renders as a
  // thumbnail cover in list/table (and, later, card) views, instead of a
  // plain text value. At most one field per database should carry this -
  // FieldsEditorSheet enforces that by clearing every other field's flag
  // the moment one is turned on.
  isCover?: boolean;
  // Appended to the row's NAME wherever it's shown (see rowTitleOf), after
  // the title field and in field order - for a table where the title field
  // repeats and only a combination identifies a row (a fleet where the
  // model is shared and the plate is what distinguishes a vehicle). The
  // field stays a normal field of its own, so it can still be filtered and
  // sorted by; only the displayed name is composed. Restricted to types
  // whose stored value IS its display text (text/number/date), since
  // rowTitleOf has no context to resolve an option or relation id with.
  inTitle?: boolean;
  // Hidden from every VIEW of the database - list, cards and table alike -
  // while still being editable in the row form, which is the only place
  // left to give it a value. fields[0] is never hideable: it's the row's
  // name everywhere.
  hidden?: boolean;
}

export interface CustomDatabase {
  id: string;
  name: string;
  icon?: string; // an Ionicons glyph name, shown on its DatabasesScreen tile
  color?: string;
  fields: FieldDef[];
  createdAt: number;
  updatedAt: number;
}

// A named, saved slice of one database: a display mode plus a sort plus a
// set of filters, under a name the user gave it. Its own flat collection
// rather than an array on the database doc, because a document can embed
// one as a live block and needs to load just that view by id.
//
// The filter/sort shapes live in utils/customRowQuery (RowFilter, RowSort)
// rather than here - they're query mechanics, used by the screen and this
// record alike, and keeping them there is what lets that module stay the
// single place a filter's meaning is defined.
export interface CustomDatabaseView {
  id: string;
  databaseId: string;
  name: string;
  viewMode: 'list' | 'table' | 'cards';
  sortField: string;
  sortDir: 'asc' | 'desc';
  // Same array the screen stores in its prefs doc; a filter naming a field
  // that has since been deleted is ignored when the view is applied.
  filters: { fieldId: string; op: 'any' | 'filled' | 'empty'; values?: string[] }[];
  // documentId -> true for every document embedding this view as a 'dbView'
  // block, same shape/purpose as CustomDatabaseRow.usedInDocuments below.
  usedInDocuments?: Record<string, boolean>;
  createdAt: number;
  updatedAt: number;
}

// One row lives in its own document in the flat `customDatabaseRows`
// collection (client-side filtered by databaseId), not embedded as an array
// on the database doc the way BoardItem.cards is - a database can grow to
// many rows, and rewriting the whole array on every single-row edit would
// repeat the exact scaling problem documents already ran into once.
export interface CustomDatabaseRow {
  id: string;
  databaseId: string;
  // Keyed by FieldDef.id. 'select' stores one FieldOption.id, 'multiSelect'
  // an array of them, 'number' a number, 'text'/'date' a string (date as an
  // ISO string). A field added after this row exists simply has no key here
  // yet - rendered as empty, not backfilled.
  values: Record<string, string | number | string[]>;
  // Tags/groups are scoped per-database (kind/GroupKind `customRow:${databaseId}`),
  // not shared across every custom database - see useTags.ts and
  // GroupPickerSheet.tsx.
  tagIds?: string[];
  groupId?: string;
  // documentId -> true for every document embedding this row as a 'dbRow'
  // block, same shape files/photos/links already use. Unlike those, a row
  // is NEVER deleted when the last document drops it - it belongs to its
  // database, not to the documents that happen to mention it.
  usedInDocuments?: Record<string, boolean>;
  createdAt: number;
  updatedAt: number;
}
