import { useChannelsStore, type Channel, type FeedItem } from "@/store/useChannelsStore";
import { useLibraryStore } from "@/store/useLibraryStore";

import { isSignedIn } from "./googleAuth";
import { latestUploads, type Subscription } from "./youtubeApi";
import { loadChannel } from "./youtubeChannels";

// Puts a found video into the library as «Планую» (the «Хочу» of the channels screen).
export function wantVideo(item: { id: string; title: string; thumbnailUrl: string }, channelName: string) {
  const lib = useLibraryStore.getState();
  const url = `https://www.youtube.com/watch?v=${item.id}`;
  if (!lib.videos.some((v) => v.url === url)) {
    lib.addVideo({
      id: `v-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      url,
      title: item.title,
      thumbnailUrl: item.thumbnailUrl,
      durationSec: 0,
      source: "youtube",
      status: "planned",
      tagIds: [],
      comment: "",
      siteName: `${channelName} · YouTube`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  useChannelsStore.getState().setItemState(item.id, "want");
}

/** A channel's latest videos: the official API when signed in to Google, else the page reader. */
async function latestFor(channelId: string) {
  if (isSignedIn()) {
    try {
      return await latestUploads(channelId, 15);
    } catch {
      // The API refused (quota, sign-in ran out): the page reader still works.
    }
  }
  return (await loadChannel(`https://www.youtube.com/channel/${channelId}`)).videos;
}

/** Reads one channel's latest videos and files what is new. Returns how many new videos there were. */
export async function refreshChannel(channel: Channel): Promise<number> {
  const videos = await latestFor(channel.id);
  const store = useChannelsStore.getState();
  const first = !store.feed.some((f) => f.channelId === channel.id);
  // A channel just added: its back catalogue is not "new" - only the freshest handful is offered.
  const items = first ? videos.slice(0, 8) : videos;
  const fresh = store.mergeFeed(
    channel.id,
    items.map((i) => ({ ...i, channelId: channel.id }))
  );
  if (channel.autoWant) fresh.forEach((f) => wantVideo(f, channel.name));
  return fresh.length;
}

/** Follows a channel picked from the user's YouTube subscriptions (with its freshest videos). */
export async function addFromSubscription(sub: Subscription): Promise<void> {
  const channel: Channel = { id: sub.channelId, name: sub.title, avatarUrl: sub.avatarUrl, topic: null, autoWant: false, addedAt: Date.now() };
  useChannelsStore.getState().addChannel(channel);
  await refreshChannel(channel).catch(() => 0);
}

/** How many channels are read at the same time: more would hog the phone (and its single JS thread) while the user scrolls. */
const REFRESH_PARALLEL = 3;

/** All channels: a few at a time, quietly, and the screen is told ONCE at the end; a failing one is skipped. */
export async function refreshAll(): Promise<void> {
  const { channels } = useChannelsStore.getState();
  const store = useChannelsStore.getState();
  const batches: { channelId: string; items: Omit<FeedItem, "state">[] }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < channels.length) {
      const channel = channels[next++];
      try {
        const videos = await latestFor(channel.id);
        const first = !store.feed.some((f) => f.channelId === channel.id);
        const items = first ? videos.slice(0, 8) : videos;
        batches.push({ channelId: channel.id, items: items.map((i) => ({ ...i, channelId: channel.id })) });
      } catch {
        // skipped
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(REFRESH_PARALLEL, channels.length) }, worker));
  const fresh = useChannelsStore.getState().mergeMany(batches);
  channels.forEach((c) => {
    if (c.autoWant) (fresh.get(c.id) ?? []).forEach((f) => wantVideo(f, c.name));
  });
  useChannelsStore.getState().setCheckedAt(Date.now());
}

/** Adds a channel from what the user pasted (a channel link, an @handle, or any video of it). */
export async function addChannelFrom(input: string): Promise<Channel> {
  const loaded = await loadChannel(input);
  const channel: Channel = { id: loaded.id, name: loaded.name, avatarUrl: loaded.avatarUrl, topic: null, autoWant: false, addedAt: Date.now() };
  const store = useChannelsStore.getState();
  store.addChannel(channel);
  store.mergeFeed(
    channel.id,
    loaded.videos.slice(0, 8).map((i) => ({ ...i, channelId: channel.id }))
  );
  return channel;
}
