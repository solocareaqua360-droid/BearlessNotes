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
}

export interface Settings {
  theme: ThemePreference;
  openVideoMode: OpenVideoMode;
  lastSyncedAt: number | null;
  account: {
    email: string;
    avatarUrl: string | null;
  } | null;
}
