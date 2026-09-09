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
  | 'table';

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
export interface Group {
  id: string;
  name: string;
  color: string;
  kind: 'file' | 'photo' | 'link-video' | 'link-geo' | 'link-other' | 'document';
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
export type TaggableKind = 'file' | 'photo' | 'link-video' | 'link-geo' | 'link-other' | 'document';

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
}
