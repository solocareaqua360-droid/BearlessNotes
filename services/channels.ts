import { useChannelsStore, type Channel } from "@/store/useChannelsStore";
import { useLibraryStore } from "@/store/useLibraryStore";

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

/** Reads one channel's page and files what is new. Returns how many new videos there were. */
export async function refreshChannel(channel: Channel): Promise<number> {
  const loaded = await loadChannel(`https://www.youtube.com/channel/${channel.id}`);
  const store = useChannelsStore.getState();
  const first = !store.feed.some((f) => f.channelId === channel.id);
  // A channel just added: its back catalogue is not "new" - only the freshest handful is offered.
  const items = first ? loaded.videos.slice(0, 8) : loaded.videos;
  const fresh = store.mergeFeed(
    channel.id,
    items.map((i) => ({ ...i, channelId: channel.id }))
  );
  if (channel.autoWant) fresh.forEach((f) => wantVideo(f, channel.name));
  return fresh.length;
}

/** All channels, in parallel; a failing one is skipped. */
export async function refreshAll(): Promise<void> {
  const { channels } = useChannelsStore.getState();
  await Promise.all(channels.map((c) => refreshChannel(c).catch(() => 0)));
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
