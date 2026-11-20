export type WatchStatus = "planned" | "watched";

export type OpenVideoMode = "in_app" | "external";

export type ThemePreference = "light" | "system" | "dark";

export type VideoSource = "youtube" | "tiktok" | "unknown";

export interface Tag {
  id: string;
  /** Display name of just this segment, e.g. "React" in "Programming/React". */
  name: string;
  /** Parent tag id, or null for a top-level tag. */
  parentId: string | null;
  icon: string;
  color: string;
}

export interface Video {
  id: string;
  url: string;
  title: string;
  thumbnailUrl: string;
  durationSec: number;
  source: VideoSource;
  status: WatchStatus;
  tagIds: string[];
  comment: string;
  createdAt: number;
  /** "author · TikTok" - stamped from oEmbed; local-only (not a Supabase column). */
  siteName?: string;
  /** Last change; the Supabase trigger keeps updated_at current. */
  updatedAt?: number;
  /** Set when the video sits in the bin («Кошик»); bin items live only on this device. */
  deletedAt?: number;
}

export type SortField = "title" | "createdAt" | "updatedAt";
export type SortDir = "asc" | "desc";
/** "folders" = explorer (folder tiles + the videos of the current folder); "all" = every video in one list. */
export type ListMode = "folders" | "all";
export type CardLayout = "grid" | "list" | "canvas";

/** The canvas ("Полотно"): where things lie on the table. Local to this device. */
export type CanvasPos = { x: number; y: number };
export type CanvasPile = { x: number; y: number; ids: string[] };
export type CanvasLayout = {
  photos: Record<string, CanvasPos>;
  folders: Record<string, CanvasPos>;
  open: Record<string, boolean>;
  piles: Record<string, CanvasPile>;
  /** Never-placed things keep their grid SLOT (not coordinates), so they still make way for an open folder. */
  slots?: Record<string, number>;
};

export interface Settings {
  sortField?: SortField;
  sortDir?: SortDir;
  listMode?: ListMode;
  cardLayout?: CardLayout;
  theme: ThemePreference;
  openVideoMode: OpenVideoMode;
  lastSyncedAt: number | null;
  account: {
    email: string;
    avatarUrl: string | null;
  } | null;
}
