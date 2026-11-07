import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { CanvasLayout, CanvasPile, Settings, SortDir, SortField, Tag, Video, WatchStatus } from "@/types";

const MAX_TAG_DEPTH = 10;

const seedTags: Tag[] = [
  { id: "tag-dev", name: "Розробка", parentId: null, icon: "code-slash", color: "#33C2FF" },
  { id: "tag-dev-rn", name: "React Native", parentId: "tag-dev", icon: "code-slash", color: "#33C2FF" },
  { id: "tag-cooking", name: "Кулінарія", parentId: null, icon: "restaurant", color: "#FFB020" },
  { id: "tag-fitness", name: "Фітнес", parentId: null, icon: "fitness", color: "#4CD97B" },
];

const seedVideos: Video[] = [
  {
    id: "v1",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Expo Router: навігація для React Native за 10 хвилин",
    thumbnailUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    durationSec: 612,
    source: "youtube",
    status: "planned",
    tagIds: ["tag-dev-rn"],
    comment: "",
    createdAt: Date.now() - 1000 * 60 * 60 * 3,
  },
  {
    id: "v2",
    url: "https://www.tiktok.com/@chef/video/1",
    title: "Швидка паста карбонара за 15 хвилин",
    thumbnailUrl: "",
    durationSec: 58,
    source: "tiktok",
    status: "watched",
    tagIds: ["tag-cooking"],
    comment: "Спробувати на вихідних",
    createdAt: Date.now() - 1000 * 60 * 60 * 24,
  },
  {
    id: "v3",
    url: "https://www.youtube.com/watch?v=abcd1234efg",
    title: "Розтяжка на 20 хвилин перед сном",
    thumbnailUrl: "",
    durationSec: 1204,
    source: "youtube",
    status: "planned",
    tagIds: ["tag-fitness"],
    comment: "",
    createdAt: Date.now() - 1000 * 60 * 30,
  },
  {
    id: "v4",
    url: "https://www.youtube.com/watch?v=zz11yy22xx3",
    title: "Zustand + AsyncStorage: офлайн-перший стан застосунку",
    thumbnailUrl: "",
    durationSec: 845,
    source: "youtube",
    status: "watched",
    tagIds: ["tag-dev", "tag-dev-rn"],
    comment: "",
    createdAt: Date.now() - 1000 * 60 * 60 * 48,
  },
];

export const BIN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface LibraryState {
  videos: Video[];
  /** The bin: local to this device, never synced, emptied after 30 days. */
  bin: Video[];
  /** Canvas arrangements by layout key; local to this device, not synced. */
  canvas: Record<string, CanvasLayout>;
  tags: Tag[];
  settings: Settings;

  addVideo: (video: Video) => void;
  updateVideo: (id: string, patch: Partial<Video>) => void;
  removeVideo: (id: string) => void;
  removeVideos: (ids: string[]) => void;
  /** Moves videos to the bin (recoverable); they leave the synced list. */
  moveToBin: (ids: string[]) => void;
  restoreFromBin: (ids: string[]) => void;
  /** Deletes from the bin for good (all of it when no ids are given). */
  purgeBin: (ids?: string[]) => void;
  purgeExpiredBin: () => void;
  /** Adds/removes a tag across many videos at once (bulk edit in multi-select). */
  setBulkTagsOnVideos: (videoIds: string[], addTagIds: string[], removeTagIds: string[]) => void;

  addTag: (tag: Tag) => void;
  /**
   * Creates (or reuses) a Bear-style "Parent/Child/Grandchild" tag chain.
   * Only the last segment gets the chosen icon/color; segments created
   * along the way as intermediate parents get a neutral folder look.
   * Returns the id of the final (leaf) tag.
   */
  addTagPath: (path: string[], leafIcon: string, leafColor: string) => string | null;
  updateTag: (id: string, patch: Partial<Tag>) => void;
  removeTag: (id: string, mode: "delete_videos" | "unsort_videos") => void;

  updateSettings: (patch: Partial<Settings>) => void;

  /** Merges a change into a canvas arrangement; a pile set to null is removed. */
  patchCanvas: (
    key: string,
    patch: {
      photos?: CanvasLayout["photos"];
      folders?: CanvasLayout["folders"];
      open?: CanvasLayout["open"];
      piles?: Record<string, CanvasPile | null>;
      slots?: Record<string, number>;
      resetFolders?: boolean;
    }
  ) => void;
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      videos: seedVideos,
      bin: [],
      canvas: {},
      tags: seedTags,
      settings: {
        sortField: "updatedAt",
        sortDir: "desc",
        listMode: "folders",
        cardLayout: "grid",
        theme: "system",
        openVideoMode: "in_app",
        lastSyncedAt: null,
        account: null,
      },

      addVideo: (video) => set((state) => ({ videos: [video, ...state.videos] })),

      updateVideo: (id, patch) =>
        set((state) => ({
          videos: state.videos.map((v) => (v.id === id ? { ...v, ...patch, updatedAt: Date.now() } : v)),
        })),

      removeVideo: (id) =>
        set((state) => ({ videos: state.videos.filter((v) => v.id !== id) })),

      removeVideos: (ids) =>
        set((state) => ({ videos: state.videos.filter((v) => !ids.includes(v.id)) })),

      moveToBin: (ids) =>
        set((state) => {
          const now = Date.now();
          const moving = state.videos.filter((v) => ids.includes(v.id)).map((v) => ({ ...v, deletedAt: now }));
          return {
            videos: state.videos.filter((v) => !ids.includes(v.id)),
            bin: [...moving, ...state.bin],
          };
        }),

      restoreFromBin: (ids) =>
        set((state) => {
          const back = state.bin.filter((v) => ids.includes(v.id)).map(({ deletedAt: _d, ...v }) => v as Video);
          return {
            bin: state.bin.filter((v) => !ids.includes(v.id)),
            videos: [...back, ...state.videos],
          };
        }),

      purgeBin: (ids) =>
        set((state) => ({ bin: ids ? state.bin.filter((v) => !ids.includes(v.id)) : [] })),

      purgeExpiredBin: () =>
        set((state) => {
          const limit = Date.now() - BIN_TTL_MS;
          const bin = state.bin.filter((v) => (v.deletedAt ?? Date.now()) > limit);
          return bin.length === state.bin.length ? state : { bin };
        }),

      setBulkTagsOnVideos: (videoIds, addTagIds, removeTagIds) =>
        set((state) => ({
          videos: state.videos.map((v) => {
            if (!videoIds.includes(v.id)) return v;
            let tagIds = v.tagIds;
            if (removeTagIds.length > 0) tagIds = tagIds.filter((id) => !removeTagIds.includes(id));
            if (addTagIds.length > 0) tagIds = Array.from(new Set([...tagIds, ...addTagIds]));
            return { ...v, tagIds };
          }),
        })),

      addTag: (tag) => set((state) => ({ tags: [...state.tags, tag] })),

      addTagPath: (path, leafIcon, leafColor) => {
        const segments = path.map((s) => s.trim()).filter(Boolean).slice(0, MAX_TAG_DEPTH);
        if (segments.length === 0) return null;

        let tags = get().tags;
        let parentId: string | null = null;
        let leafId: string | null = null;

        segments.forEach((name, index) => {
          const isLeaf = index === segments.length - 1;
          const existing = tags.find(
            (t) => t.parentId === parentId && t.name.toLowerCase() === name.toLowerCase()
          );

          if (existing) {
            if (isLeaf) {
              tags = tags.map((t) =>
                t.id === existing.id ? { ...t, icon: leafIcon, color: leafColor } : t
              );
            }
            parentId = existing.id;
            leafId = existing.id;
          } else {
            const newTag: Tag = {
              id: `tag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name,
              parentId,
              icon: isLeaf ? leafIcon : "folder",
              color: isLeaf ? leafColor : "#8A8A94",
            };
            tags = [...tags, newTag];
            parentId = newTag.id;
            leafId = newTag.id;
          }
        });

        set({ tags });
        return leafId;
      },

      updateTag: (id, patch) =>
        set((state) => ({
          tags: state.tags.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),

      removeTag: (id, mode) =>
        set((state) => {
          const descendantIds = new Set<string>([id]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const t of state.tags) {
              if (t.parentId && descendantIds.has(t.parentId) && !descendantIds.has(t.id)) {
                descendantIds.add(t.id);
                changed = true;
              }
            }
          }

          const tags = state.tags.filter((t) => !descendantIds.has(t.id));

          const videos =
            mode === "delete_videos"
              ? state.videos.filter((v) => !v.tagIds.some((tagId) => descendantIds.has(tagId)))
              : state.videos.map((v) => ({
                  ...v,
                  tagIds: v.tagIds.filter((tagId) => !descendantIds.has(tagId)),
                }));

          return { tags, videos };
        }),

      updateSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),

      patchCanvas: (key, patch) =>
        set((state) => {
          const prev: CanvasLayout = state.canvas[key] ?? { photos: {}, folders: {}, open: {}, piles: {} };
          const piles = { ...prev.piles };
          Object.entries(patch.piles ?? {}).forEach(([id, rec]) => {
            if (rec) piles[id] = rec;
            else delete piles[id];
          });
          const next: CanvasLayout = {
            photos: { ...prev.photos, ...(patch.photos ?? {}) },
            folders: patch.resetFolders ? {} : { ...prev.folders, ...(patch.folders ?? {}) },
            open: { ...prev.open, ...(patch.open ?? {}) },
            piles,
            slots: { ...(prev.slots ?? {}), ...(patch.slots ?? {}) },
          };
          return { canvas: { ...state.canvas, [key]: next } };
        }),
    }),
    {
      name: "bearlessnotes-library",
      storage: createJSONStorage(() => AsyncStorage),
      // Settings gained keys: merge them over the defaults instead of letting
      // an older saved object replace the whole thing.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LibraryState>;
        return { ...current, ...p, settings: { ...current.settings, ...(p.settings ?? {}) }, bin: p.bin ?? [], canvas: p.canvas ?? {} };
      },
    }
  )
);

export function filterVideos(
  videos: Video[],
  opts: { status?: WatchStatus | "all"; tagIds?: string[]; query?: string; unsortedOnly?: boolean }
): Video[] {
  const { status = "all", tagIds = [], query = "", unsortedOnly = false } = opts;
  const normalizedQuery = query.trim().toLowerCase();

  return videos.filter((video) => {
    if (status !== "all" && video.status !== status) return false;
    if (unsortedOnly) {
      if (video.tagIds.length > 0) return false;
    } else if (tagIds.length > 0 && !tagIds.some((id) => video.tagIds.includes(id))) {
      return false;
    }
    if (normalizedQuery && !video.title.toLowerCase().includes(normalizedQuery)) return false;
    return true;
  });
}

export function sortVideos(videos: Video[], field: SortField, dir: SortDir): Video[] {
  const sorted = [...videos].sort((a, b) => {
    if (field === "title") return a.title.localeCompare(b.title, "uk", { sensitivity: "base", numeric: true });
    if (field === "createdAt") return a.createdAt - b.createdAt;
    return (a.updatedAt ?? a.createdAt) - (b.updatedAt ?? b.createdAt);
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

/** "5 жовт., 14:30" - the date line on a card. */
export function formatStamp(ms: number): string {
  return new Date(ms).toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(totalSeconds: number): string {
  if (!totalSeconds) return "--:--";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const paddedSeconds = seconds.toString().padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}
