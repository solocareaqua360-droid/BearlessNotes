import { LinkCategory } from './utils/linkCategory';
export type BlockType =
  | 'paragraph'
  // A heading, at one of three levels (headingLevel). Text pasted from
  // anywhere markdown-shaped carries "#", "##", "###", and without a
  // heading to become they stayed as the hashes themselves - which is
  // what a pasted page of notes looked like.
  | 'heading'
  // A block of code: monospaced, on its own ground, and the one block
  // where every newline is the author's own - nothing in it is parsed,
  // split or formatted.
  | 'code'
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
  | 'dbView'
  // Another DOCUMENT, embedded as a card. The user's own words: "вставити
  // в документ картку іншого документа (як посилання)".
  //
  // Live, like 'dbRow' and for the same reason: rename a note and every
  // note that mentions it should say the new name. What is stored on the
  // block is the id and a snapshot of the title - the snapshot is the
  // fallback, for a note that has been deleted and for the first frame
  // before the listener answers, exactly as useLiveRecords describes.
  | 'docRef';

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
  // Where this block sits when the document is looked at as a CANVAS
  // ("Полотно" - see DocumentCanvas). Absent means "never moved": the
  // canvas lays such a block out down a column in reading order and only
  // writes a position once the block is actually dragged, so a document
  // nobody has arranged on the canvas carries nothing extra, and its page
  // order stays the one true order.
  canvas?: { x: number; y: number };
  // 'divider' blocks only - the line the canvas puts between what its
  // arrows assembled and everything they did not touch (see
  // assembleWithDivider). Marked so that leaving the canvas again finds
  // the line it made last time and moves it rather than adding a second.
  canvasDivider?: boolean;
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
  // 'docRef' blocks only - which document this card stands for, and its
  // title as it was when the card was made (see the type above for why
  // both).
  docRefId?: string;
  docRefTitle?: string;
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
  // References a doc in the shared 'groups' collection (see Group) - a
  // task's own "Проект" is the same mechanism every other database's
  // group is, kind: 'task'.
  groupId?: string;
  // 'checkbox' blocks only - references a doc in 'taskLists', which
  // itself references the SAME project via its own groupId. Only
  // meaningful alongside a matching groupId; a list picker has
  // nothing to offer a task with no project yet.
  listId?: string;
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
  reminderNotificationId?: string; // notifee id, to cancel/reschedule
  // Absent means 'alarm' - a reminder made before this field existed was
  // scheduled as one (see reminders.ts's history), so treating it that
  // way is what keeps it doing what it already does rather than quietly
  // going quiet the next time it is edited.
  reminderKind?: 'notify' | 'alarm';
  // 'checkbox' blocks only, all three below - shown ONLY in TasksScreen's
  // own expanded row, never in the document itself (same reasoning as
  // subtasks: quick and disposable, not meant to carry the weight of a
  // real block in the page's own reading order).
  //
  // A longer free-text note - the task's own text stays the one-line
  // label, this is where the detail goes.
  comment?: string;
  // A step that never becomes a document block or a mirror record of its
  // own - it only ever appears nested under its own parent's expanded
  // row. Deliberately NOT a nested Block: a subtask has no project, no
  // reminder, no kanban column and no document of its own, so giving it
  // the full Block shape would invite all of that machinery for
  // something meant to stay small.
  subtasks?: Subtask[];
  // A copy of an existing file/photo record - the SAME convention
  // AddExistingItemModal already produces for a document's own blocks
  // (see blockFromFile/blockFromPhoto in copyToNote.ts): the task gets
  // its own copy, not a live reference back to the original.
  attachments?: Block[];
  // 'checkbox' blocks only - see Recurrence. Checking a task that
  // carries this creates the NEXT occurrence (one at a time, never a
  // batch of future dates - the user's own choice) as a fresh sibling
  // block, carrying this same rule, groupId and listId forward but
  // never subtasks/comment/attachments, which start empty each time.
  recurrence?: Recurrence;
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
  // 'heading' blocks only: 1, 2 or 3. Absent means 2, which is what a
  // heading typed rather than pasted starts as.
  headingLevel?: number;
  // 'code' blocks only: what was written after the opening fence of a
  // pasted block, kept so it can be shown and, one day, coloured.
  codeLanguage?: string;
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

// A checkbox task's own sub-step - see Block.subtasks for why this is
// its own small shape rather than a nested Block.
export interface Subtask {
  id: string;
  text: string;
  checked: boolean;
}

// A checkbox task's own repeat rule - see Block.recurrence. `weekday` is
// Monday-first (0=Monday..6=Sunday), matching WEEKDAY_SHORT/WEEKDAY_FULL
// (utils/dateLocale) rather than JS's own Date.getDay() (0=Sunday) - the
// app's own vocabulary for a day of the week, everywhere else it already
// appears.
export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'weekday';
  weekday?: number; // only meaningful when freq === 'weekday'
}

// A sub-grouping INSIDE one project - same shape as Group, and a
// manageable entity of its own (name, colour, rename, delete) by the
// user's own choice, rather than a free-text tag. Scoped to exactly one
// project via `groupId`: a list is meaningless without knowing which
// project's own list it is, so a task can only be assigned one once it
// already has a project.
export interface TaskList {
  id: string;
  name: string;
  color: string;
  groupId: string;
  // A short line shown under the list's own name, above its tasks - the
  // user's own ask, distinct from a task's own comment (Block.comment):
  // this describes the LIST, not any one thing in it.
  description?: string;
}

// This is the app's ONE cross-database "Проект" concept, user-facing name
// aside - `Group` and the `groups` collection are the original names and
// stay that way in code (renaming either would mean losing every group any
// database has today), but every screen now shows the word "Проект" for
// it. Tasks used to keep a wholly separate `projectId`/`projects` pair (the
// now-removed `Project` type) for the exact same idea; that's retired in
// favour of this one, wider mechanism (`kind: 'task'` joins document/
// photo/file/link-*/board/customRow below) rather than the reverse, since
// this side already touched more of the app. `kind` scopes membership to
// the one database an item was created in - a project made while looking
// at Photos must not show up as an option in Files or Links. Links split
// into their own video/geo/other kinds, same as TaggableKind does for tags
// and for the same reason: a video's projects and a geo point's projects
// are different vocabularies in practice.
// As opposed to a tag (the permanent library - a tree, hundreds of them,
// one item filed in several places at once), a project/group is meant as a
// looser, temporary gathering - "what I'm living with right now" - on the
// order of a hundred items of mixed types, archived once that period is
// over rather than deleted, its contents by then filed away with tags.
export interface Group {
  id: string;
  name: string;
  color: string;
  // Which databases this group shows up in - 'document' | 'photo' | 'file'
  // | 'link-*' | 'board' | 'task' | `customRow:${databaseId}`. A group
  // used to belong to
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
  // A tag only exists while this has at least one key - see useTags -
  // unless it is kept (below).
  usedIn: Record<string, true>;
  // A folder made on purpose, in «Провідник», rather than one that came
  // into being by tagging something: it stays when it is empty. The
  // ordinary rule (an unused tag is deleted) is what keeps the drawer free
  // of dead branches, and it still holds for every tag without this.
  keep?: boolean;
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
  // Where this card sits in its column, counted from the top. The place
  // it is DRAWN at is worked out from the measured heights of the cards
  // above it - and those differ between a phone and a laptop, because
  // text wraps differently. Storing the drawn position made the two
  // devices disagree forever, each recomputing the other's numbers and
  // writing them back. An index is the same everywhere.
  order?: number;
  width: number;
  // 'paragraph' (sticky-note) cards only - no other Block usage in the app
  // has a per-block color, so this lives here rather than on Block itself.
  color?: string;
  // 'paragraph' (наліпка) cards only - its own text size, stepped through
  // the same scale a shape's text uses so the two read on one ruler.
  // Absent means the sticky's own default.
  fontSize?: number;
  // 'image' cards only - drops the white card chrome and the "Без назви"
  // caption strip, leaving just the picture. Board-specific for the same
  // reason color is: a document's own image block always keeps its
  // caption, since that is where a picture's title is actually set.
  imageBare?: boolean;
  // 'image' cards only - draw the picture in ITS OWN proportions rather
  // than in the card's fixed 90/144 window. The shape a picture is
  // actually in is not stored: it is read off the file (Image.getSize)
  // when the card is drawn, because it is DERIVED from the picture and
  // storing derived data is how two devices end up disagreeing about it.
  imageNatural?: boolean;
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
  // Which BoardLayer this card belongs to, if any - see BoardLayer's own
  // comment for how it differs from a column or a container.
  layerId?: string;
  // This card's OWN hide flag, independent of its layer's - the user's
  // own ask: "кожен із об'єктів можна окремо приховати показати". Either
  // one hides it; see BoardScreen's own isHidden helper for how the two
  // combine.
  hidden?: boolean;
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
  // Absent/'plain' - a plain line, no arrowhead, no relation between the
  // two ends when either is dragged (today's only behaviour). 'arrow' -
  // one arrowhead at the `toCardId` end: `fromCardId` is the "parent" -
  // dragging it (or a container it's a member of) carries `toCardId`
  // along; dragging `toCardId` does NOT move `fromCardId` back. Flipping
  // which end is the parent swaps fromCardId/toCardId rather than adding
  // a direction field of its own. 'doubleArrow' - an arrowhead at BOTH
  // ends: either side moves the other. The move-together behaviour
  // itself is a later phase; this field exists for the line's own look
  // first (see BoardScreen's own comment on why it's built in two steps).
  kind?: 'plain' | 'arrow' | 'doubleArrow';
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
  // Set only on a column inserted via "Проект справ" - unlike every other
  // column, its members are never stored as BoardCards at all. They're
  // computed live, every render, straight from the `tasks` collection
  // (filtered by a task's own groupId/listId) - the whole point being
  // that a task added to the project/list afterwards shows up here with
  // no re-import, and ticking one off here IS ticking off the real task
  // (see BoardScreen's own liveTaskSource comment for the rendering
  // side). One list is always one column (the user's own call) - "весь
  // проект" inserts one of these per list PLUS one 'projectUnlisted' for
  // whatever's left with no list. `groupId: null` means "Вхідні".
  liveTaskSource?: { kind: 'projectUnlisted'; groupId: string | null } | { kind: 'list'; listId: string };
  // See BoardCard's own layerId/hidden comments - the same two fields,
  // same meaning, on a column instead of a card. A column carried NEITHER
  // until now - «Шари» listed cards/shapes/containers only, so a column
  // (a «Проект справ» one especially) had no way into the panel at all.
  layerId?: string;
  hidden?: boolean;
}

// FURNITURE, NOT CONTENT.
//
// A shape or a loose word on a board is DECORATION and nothing else -
// the user drew the line themselves, and it is the sharpest line in this
// screen: "це просто заповнення дошки, якісь елементи оформлення. І все.
// Я не буду потім з цього ромба робити картку. Зберігати її. Ні."
//
// So a shape is deliberately NOT a BoardCard. A card is a BLOCK: it can
// be collected into a document, grouped, tagged, and it is the board's
// whole reason for existing. None of that may ever happen to a diamond.
// Keeping them in a separate list is what makes that true by
// construction rather than by everyone remembering to skip them - every
// piece of code that walks `cards` is already correct for shapes,
// because shapes are not in it.
//
// Lives on the board document and nowhere else: no mirror collection, no
// database record, nothing to find it by.
export type BoardShapeKind =
  | 'text'
  | 'rect'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'ellipse'
  | 'circle';

// A FREE-STANDING FRAME, not a kanban lane. `BoardColumn` above forces
// its members into a single stacked order and cannot hold a shape at
// all - this is the opposite on both counts: a resizable rectangle,
// transparent inside, that a card or a shape belongs to purely by
// GEOMETRY - whatever currently sits inside its bounds when the frame
// itself is dragged, moves with it, and nothing is written down to say
// so beforehand. Dragging a card or shape back out is not a release
// action, it is just no longer being inside the rectangle. This is the
// user's own ask: "їх спокійно витягнути або помістити в область".
//
// No membership list and no `containerId` field on BoardCard/BoardShape
// on purpose - a member is discovered fresh every time the frame is
// dragged (see containerMembersAt in BoardScreen), never persisted, so
// there is nothing to keep in sync when a card moves on its own.
// An ORGANISATIONAL grouping (Photoshop's own idea of a layer), never a
// spatial one - a BoardContainer already covers "a region on the
// canvas"; this is "a named bucket in a list" with no x/y of its own.
// Cards, shapes AND containers can all belong to one (see their own
// layerId), which is why this lives beside them rather than under any
// one of the three.
export interface BoardLayer {
  id: string;
  name: string;
  // Hides every member regardless of the member's OWN hidden flag - see
  // Block... no, see BoardCard/BoardShape/BoardContainer's own `hidden`
  // comment for how the two combine.
  hidden?: boolean;
  // Blocks moving, resizing, editing and deleting every member. Visible
  // means visible - lock is only ever about protecting from a mistake,
  // never a second way to hide something.
  locked?: boolean;
}

export interface BoardContainer {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  // The label's own size - absent means SHAPE_LABEL_SIZE_DEFAULT
  // (BoardScreen), a step in the SAME SHAPE_TEXT_SIZES scale a shape's
  // text uses, on purpose: the user asked to compare sizes BY NUMBER
  // rather than by eye, which only holds if every piece of board text
  // is measured on one shared scale rather than each control inventing
  // its own.
  fontSize?: number;
  // See BoardCard's own layerId/hidden comments.
  layerId?: string;
  hidden?: boolean;
}

export interface BoardShape {
  id: string;
  kind: BoardShapeKind;
  x: number;
  y: number;
  width: number;
  // Free for a rectangle, an ellipse and a triangle; tied to the width
  // for a square and a circle, and ignored by text, which is as tall as
  // its own words.
  height: number;
  // Words written inside the outline - or, for 'text', the whole thing.
  text?: string;
  // The outline's own colour. The fill (see `filled`) is the same
  // colour, much weaker, so one value describes the shape.
  color?: string;
  // Off by default - an outline reads as a container, which is the more
  // common use ("розкласти по групах"); on, the shape gets a soft wash of
  // its own colour so it reads as a filled block instead.
  filled?: boolean;
  // Absent means the size the shape was born with. A step in
  // SHAPE_TEXT_SIZES (BoardScreen), never a free number - the point the
  // user raised was being unable to make a label read from across the
  // board, not fine typographic control.
  fontSize?: number;
  // See BoardCard's own layerId/hidden comments - the same two fields,
  // same meaning, on furniture instead of a card.
  layerId?: string;
  hidden?: boolean;
}

export interface BoardItem {
  id: string;
  title: string;
  cards: BoardCard[];
  connections?: BoardConnection[];
  columns?: BoardColumn[];
  // See BoardShape: the board's own furniture, never blocks.
  shapes?: BoardShape[];
  // See BoardContainer.
  containers?: BoardContainer[];
  // See BoardLayer.
  layers?: BoardLayer[];
  // A board is a record of a database like any other now: it carries tags
  // (which are also its folders - see the explorer), a group, and a bin
  // flag. Absent on every board made before that, and read as empty.
  tagIds?: string[];
  groupId?: string;
  trashed?: boolean;
  trashedAt?: number;
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
  // The cover's own backup on Drive, and the size of it (which a later
  // delete needs, to take the same amount back off the storage counter).
  //
  // Its own, and that is the point. The cover used to look for a copy by
  // hunting through this note's blocks for one whose picture happened to
  // be the same file - so a cover set from the gallery, the camera or the
  // stock search, which matches no block, had no copy anywhere, and every
  // other device drew an empty frame where it should be. Absent on any
  // cover set before this shipped.
  coverDriveFileId?: string;
  coverDriveBytes?: number;
  // Every other document this one points at, kept up to date on save the
  // same way its tasks, links and photos are (see
  // syncDocumentLinksForDocument). Derived - it holds nothing that is not
  // already in `blocks` - and it exists so the question can be asked the
  // other way round: "which notes mention THIS one". Absent on any
  // document not saved since links existed, which reads as none.
  linksTo?: string[];
  // The gradient the user chose for the cover, by id (see theme/covers).
  // Absent = the note's own default gradient; a coverImageUri wins over
  // either.
  coverGradient?: string;
  // Takes a WHOLE row of the documents grid instead of one cell, with
  // the cover standing on its left - the user's own shape for a note
  // that matters more than its neighbours: "картку розміром як дві,
  // обкладинка ліворуч". Only the grid honours it; a list row is
  // already full width.
  wideCard?: boolean;
  // In the bin. A deleted note is not deleted: it is stamped with the
  // moment it went, every list leaves it out, and the bin shows it until
  // it is restored or thrown away for good (or thirty days pass). Its
  // tags, mirrors and arrows are left exactly as they were, so restoring
  // gives back the whole note and not a shell of one.
  deletedAt?: number;
  // Arrows between blocks on the note's canvas («Полотно»). A keyed map,
  // never an array: a merge of a map into an array field REPLACES the
  // array (which is how a board lost four cards), and a map merges one
  // link at a time. Lives on the document rather than on a block because
  // a link belongs to two blocks equally and either can be deleted first.
  canvasLinks?: Record<string, CanvasLink>;
}

export interface CanvasLink {
  from: string;
  to: string;
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

// A 'date' field's value once it covers more than one day, or carries a
// time of day - "у Notion дата розтягується початок-кінець, і це в одній
// клітинці" / "потрібно вибирати і час... у який час автомобіль вийде, у
// який час автомобіль повернеться", both the user's own references. A
// plain string (today's only shape, a dateKey) still means one day, no
// time; this is additive, so every existing single date stays exactly as
// it was with nothing to migrate. `end` absent means "picked as a range
// but no end chosen yet" reads the same as a single day. `startTime`/
// `endTime` ("HH:mm", 24h) are independent of whether `end` is set - a
// same-day trip still has a departure and a return time.
export interface DateRangeValue {
  start: string;
  end?: string;
  startTime?: string;
  endTime?: string;
}

// What a 'relation' field points at - the built-in Photos database, or
// another user-created one. A row's value for such a field is just the
// target's id as a plain string (CustomDatabaseRow.values already allows a
// string there, same shape 'select' already uses for its one chosen
// FieldOption.id - no new value shape needed).
export type RelationTarget =
  | { kind: 'photos' }
  // The built-in Files database. A record that is a contract, a car or a
  // machine usually has papers attached to it, and those papers already
  // live in Файли - so the link points at them where they are rather than
  // making a second copy inside the database.
  | { kind: 'files' }
  // One of the three link databases. They are one `links` collection split
  // by the site a link came from (see utils/linkCategory), so the category
  // has to travel with the target - a field pointing at "Геоточки" must not
  // offer YouTube covers.
  | { kind: 'links'; category: LinkCategory }
  | { kind: 'customDb'; databaseId: string };

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
  // 'relation' only - the row holds an ARRAY of target ids instead of one,
  // and the picker becomes a multi-select. What a gallery is: several
  // photos of the same car, as against the single cover below.
  multiple?: boolean;
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
  viewMode: 'list' | 'table' | 'cards' | 'schedule';
  sortField: string;
  sortDir: 'asc' | 'desc';
  // Same array the screen stores in its prefs doc; a filter naming a field
  // that has since been deleted is ignored when the view is applied.
  filters: { fieldId: string; op: 'any' | 'filled' | 'empty'; values?: string[] }[];
  // Which field the list/table/gallery groups its rows under, same as
  // filters - a field that no longer exists is ignored when applied.
  groupFieldId?: string;
  // This view's OWN property visibility, layered on top of a field's own
  // database-wide `hidden` flag (see FieldDef.hidden) rather than
  // replacing it - a field hidden database-wide stays hidden everywhere
  // regardless of this list, but a view can hide MORE for its own purpose
  // (e.g. a "Для клієнта" view hiding the VIN a "Для механіка" one shows).
  hiddenFieldIds?: string[];
  // Shown on this view's own capsule at the top of the screen, chosen
  // separately from its representation's own icon (VIEW_ICONS) since a
  // view is no longer just "the table shape" - it's a whole bundle of
  // parameters, and two views sharing one representation still want to
  // read apart at a glance.
  icon?: string;
  // The project this VIEW itself belongs to (not its rows' own project) -
  // references the same shared `groups` collection every other project
  // does, scoped to this database's own kind (`customRow:${databaseId}`),
  // so a view surfaces alongside this database's other items when
  // browsing that project.
  groupId?: string;
  // 'schedule' only - a Gantt-style grid pivoted off one of THIS
  // database's own relation fields: `rowRelationFieldId` names which
  // field points at the "row database" (`rowRelationFieldId`'s own
  // relationTarget.databaseId, duplicated here as `rowDatabaseId` so the
  // view doesn't have to look the field back up just to know its rows'
  // source), and every row of THIS database whose relation is filled
  // becomes an event spanning `dateFieldId`'s own date (or date range -
  // see DateRangeValue) under that row. Nothing else about 'list'/
  // 'table'/'cards' applies to this mode - sortField/filters are simply
  // unused rather than repurposed.
  scheduleConfig?: {
    rowDatabaseId: string;
    rowRelationFieldId: string;
    dateFieldId: string;
    // A day this schedule's own event layer leaves free can carry ONE of
    // these instead - "черговий/днювальний" was the user's own case, but
    // named/coloured here rather than hard-coded, since nothing about the
    // schedule view itself is fleet-specific. Stored per (row, day) in
    // the separate ScheduleCellStatus collection below, never on a
    // FieldDef anywhere - it belongs to this ONE view, not to either
    // database's own schema.
    manualStatuses?: FieldOption[];
    // Extra fields of THIS database (e.g. a driver relation, a route text
    // field) shown as small lines on an event card, below its title - the
    // event's exact date/time range is always shown too and isn't part of
    // this list. Never includes rowRelationFieldId/dateFieldId themselves,
    // since those are already the row grouping and the card's own span.
    cardFieldIds?: string[];
    // A summary line under the date header counting, per day, how many
    // rows have NOTHING on them - no event and no manual status. The
    // fleet case this was asked for is "скільки машин вільні цього дня"
    // (a vehicle on a trip or in «ремонт» is not available), but like
    // everything else here it is named for what it does rather than for
    // vehicles: a schedule of people answers "who is free" with the same
    // count. Off unless asked for - a schedule read row by row has no
    // use for it.
    showDayTotals?: boolean;
  };
  // documentId -> true for every document embedding this view as a 'dbView'
  // block, same shape/purpose as CustomDatabaseRow.usedInDocuments below.
  usedInDocuments?: Record<string, boolean>;
  createdAt: number;
  updatedAt: number;
}

// A PERIOD of a schedule view carrying a manual status (see
// CustomDatabaseView.scheduleConfig.manualStatuses) - "ремонт" (repair)
// spanning a planned start/end, not one cell per day: the user's own
// complaint was having to tap through every single day of a weeks-long
// repair by hand. `endDate` is the PLANNED end - extendable later (tap
// any day already inside the period, see openScheduleStatusPicker) once
// the real one turns out later than planned, and absent for a single-day
// status the same short "чорговий"/"днювальний" kind already was. A flat
// collection rather than embedded in the view or in either database's
// rows, because it belongs to none of them alone: it's specific to ONE
// view's own reading of the calendar, and there is no natural single
// owner document for a period that could grow to many per row.
export interface ScheduleCellStatus {
  id: string;
  viewId: string;
  rowId: string;
  statusId: string;
  startDate: string;
  endDate?: string;
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
  // an array of them, 'number' a number, 'text' a string, 'date' a dateKey
  // string ("YYYY-MM-DD") OR, once it's a range, a DateRangeValue - see its
  // own comment. A field added after this row exists simply has no key here
  // yet - rendered as empty, not backfilled.
  values: Record<string, string | number | string[] | DateRangeValue>;
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
