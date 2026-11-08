import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// CHANNELS the user follows and the new videos found in them. Kept apart from
// the library (offline-first, local): a video only enters the library when the
// user says «Хочу».
export interface Channel {
  id: string; // the YouTube channel id, UC...
  name: string;
  avatarUrl?: string;
  /** A free-text topic the channel is filed under (the capsules at the top). */
  topic: string | null;
  /** New videos of this channel go straight to «Хочу» (the library) instead of being offered. */
  autoWant: boolean;
  addedAt: number;
}

export interface FeedItem {
  id: string; // the YouTube video id
  channelId: string;
  title: string;
  thumbnailUrl: string;
  /** When it came out, as well as the page told (it only says «4 дн. тому»). */
  publishedAt: number;
  state: "new" | "want" | "dismissed";
}

const PER_CHANNEL = 40;

interface ChannelsState {
  channels: Channel[];
  feed: FeedItem[];
  /** When the feeds were last refreshed, ms. */
  checkedAt: number;
  addChannel: (c: Channel) => void;
  updateChannel: (id: string, patch: Partial<Channel>) => void;
  removeChannel: (id: string) => void;
  /** Adds videos not seen before as «new» (or as given); returns the ones that were really new. */
  mergeFeed: (channelId: string, items: Omit<FeedItem, "state">[], state?: FeedItem["state"]) => FeedItem[];
  /** Several channels at once, in ONE state change (a refresh must not redraw the screen per channel). Returns the new ones per channel. */
  mergeMany: (batches: { channelId: string; items: Omit<FeedItem, "state">[] }[]) => Map<string, FeedItem[]>;
  setItemState: (videoId: string, state: FeedItem["state"]) => void;
  setCheckedAt: (ms: number) => void;
}

export const useChannelsStore = create<ChannelsState>()(
  persist(
    (set, get) => ({
      channels: [],
      feed: [],
      checkedAt: 0,
      addChannel: (c) => set((s) => (s.channels.some((x) => x.id === c.id) ? s : { channels: [...s.channels, c] })),
      updateChannel: (id, patch) => set((s) => ({ channels: s.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      removeChannel: (id) => set((s) => ({ channels: s.channels.filter((c) => c.id !== id), feed: s.feed.filter((f) => f.channelId !== id) })),
      mergeFeed: (channelId, items, state = "new") => {
        const known = new Set(get().feed.map((f) => f.id));
        const fresh: FeedItem[] = items.filter((i) => !known.has(i.id)).map((i) => ({ ...i, state }));
        if (fresh.length) {
          set((s) => {
            const others = s.feed.filter((f) => f.channelId !== channelId);
            const mine = [...fresh, ...s.feed.filter((f) => f.channelId === channelId)]
              .sort((a, b) => b.publishedAt - a.publishedAt)
              .slice(0, PER_CHANNEL);
            return { feed: [...others, ...mine] };
          });
        }
        return fresh;
      },
      mergeMany: (batches) => {
        const known = new Set(get().feed.map((f) => f.id));
        const freshBy = new Map<string, FeedItem[]>();
        for (const b of batches) {
          const fresh: FeedItem[] = b.items.filter((i) => !known.has(i.id)).map((i) => ({ ...i, state: "new" as const }));
          fresh.forEach((f) => known.add(f.id));
          if (fresh.length) freshBy.set(b.channelId, fresh);
        }
        if (freshBy.size) {
          set((s) => {
            const keep = s.feed.filter((f) => !freshBy.has(f.channelId));
            const touched = s.feed.filter((f) => freshBy.has(f.channelId));
            const merged: FeedItem[] = [];
            freshBy.forEach((fresh, channelId) => {
              merged.push(
                ...[...fresh, ...touched.filter((f) => f.channelId === channelId)]
                  .sort((a, b) => b.publishedAt - a.publishedAt)
                  .slice(0, PER_CHANNEL)
              );
            });
            return { feed: [...keep, ...merged] };
          });
        }
        return freshBy;
      },
      setItemState: (videoId, state) => set((s) => ({ feed: s.feed.map((f) => (f.id === videoId ? { ...f, state } : f)) })),
      setCheckedAt: (ms) => set({ checkedAt: ms }),
    }),
    { name: "cinema-channels", storage: createJSONStorage(() => AsyncStorage) }
  )
);
