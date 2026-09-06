export type BlockType =
  | 'paragraph'
  | 'bulleted'
  | 'numbered'
  | 'checkbox'
  | 'divider'
  | 'image'
  | 'file'
  | 'link'
  | 'sketch';

// One freehand stroke in a 'sketch' block - `d` is a plain SVG path `d`
// attribute ("M10 10 L12 12 ...") built up point-by-point while drawing.
export interface SketchStroke {
  d: string;
  color: string;
  width: number;
}

export interface Block {
  id: string;
  text: string;
  // Absent/undefined means 'paragraph' - keeps every block already saved in
  // Firestore before block types existed valid without a migration.
  type?: BlockType;
  checked?: boolean; // 'checkbox' blocks only
  imageUri?: string; // 'image' blocks only
  // 'image' blocks only. Absent means 'contain' (real proportions, pale
  // gray letterboxing) - keeps images saved before this setting existed
  // displaying the same as they already did.
  imageFit?: 'contain' | 'cover';
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
  // 'link' blocks only - a paragraph containing a bare URL auto-converts
  // into one of these. text holds the original URL. Preview fields are
  // best-effort (fetched once at conversion time) and absent when nothing
  // could be fetched, in which case the block renders as a compact
  // icon-only card instead of erroring or staying plain text.
  linkUrl?: string;
  linkTitle?: string;
  linkImageUrl?: string;
  linkSiteName?: string;
  // 'sketch' blocks only. Strokes are kept as vector data (not a flattened
  // image) specifically so the drawing can be reopened and continued, the
  // way Google Keep's drawings work. sketchWidth/sketchHeight are the
  // canvas size the strokes' coordinates were captured against - the
  // editor and the inline preview both use that as the SVG viewBox so a
  // drawing still scales correctly if reopened on a different screen size.
  sketchStrokes?: SketchStroke[];
  sketchWidth?: number;
  sketchHeight?: number;
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
  kind: 'file' | 'photo' | 'link-video' | 'link-geo' | 'link-other';
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
}
