import { router } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import EdgeFade from "@/components/EdgeFade";
import { Ionicons } from "@/components/icons/Ionicons";
import { ask, notify } from "@/components/ui/Ask";
import { DeskDock } from "@/components/ui/DeskDock";
import { DOCK_CLEARANCE } from "@/components/ui/Dock";
import NamePrompt from "@/components/ui/NamePrompt";
import { ShelfRow } from "@/components/ui/ShelfRow";
import { Pill } from "@/components/ui/Pill";
import { TopBar, topBarSpace } from "@/components/ui/TopBar";
import { addChannelFrom, refreshAll, wantVideo } from "@/services/channels";
import { isSignedIn, signInWithGoogle, signOutOfGoogle } from "@/services/googleAuth";
import { useGoogleStore } from "@/store/useGoogleStore";
import { errorMessage } from "@/services/errorMessage";
import { useChannelsStore, type Channel, type FeedItem } from "@/store/useChannelsStore";
import { FONT, RADIUS, SIDE, TYPE, useSoft } from "@/theme/soft";
import { goDesk } from "@/utils/desks";
import { timeAgo as ago } from "@/utils/timeAgo";

// «КАНАЛИ»: the channels the user follows, what is NEW in them, grouped by
// channel. Each new video can be taken («♡ Хочу» - it goes into the library as
// «Планую») or waved away («✕ Не цікаво» - it is never offered again). The
// capsules at the top are the topics the channels are filed under.
const ALL = "__all__";
const NONE = "__none__"; // the capsule «Без теми»
const MAX_PER_CHANNEL = 12;

export default function ChannelsScreen() {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // A tile is about half the screen wide: several shelves fit one screen, and the next tile peeks in from behind.
  const tileWidth = Math.min(250, Math.round(width * 0.52));
  const signedIn = useGoogleStore((g) => !!g.refreshToken);
  const channels = useChannelsStore((s) => s.channels);
  const feed = useChannelsStore((s) => s.feed);
  const checkedAt = useChannelsStore((s) => s.checkedAt);
  const updateChannel = useChannelsStore((s) => s.updateChannel);
  const removeChannel = useChannelsStore((s) => s.removeChannel);
  const setItemState = useChannelsStore((s) => s.setItemState);

  const [topic, setTopic] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [topicFor, setTopicFor] = useState<Channel | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  }, []);
  // Coming in after a while: look for news.
  useEffect(() => {
    if (channels.length && Date.now() - checkedAt > 15 * 60000) doRefresh();
    // Only on entering the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topics = useMemo(() => Array.from(new Set(channels.map((c) => c.topic).filter((t): t is string => !!t))), [channels]);
  // «Без теми» exists only while at least one channel has no topic.
  const hasUntopiced = useMemo(() => channels.some((c) => !c.topic), [channels]);
  useEffect(() => {
    if (topic === NONE ? !hasUntopiced : topic !== ALL && !topics.includes(topic)) setTopic(ALL);
  }, [topic, topics, hasUntopiced]);

  // One entry per channel with something new. A channel whose videos did not change keeps the SAME
  // array, so its shelf is not redrawn when another channel is refreshed.
  const keptItems = useRef(new Map<string, FeedItem[]>());
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const byChannel = new Map<string, FeedItem[]>();
    for (const f of feed) {
      if (f.state !== "new" || (needle && !f.title.toLowerCase().includes(needle))) continue;
      const list = byChannel.get(f.channelId);
      if (list) list.push(f);
      else byChannel.set(f.channelId, [f]);
    }
    const out: { channel: Channel; items: FeedItem[]; total: number }[] = [];
    for (const c of channels) {
      if (topic === NONE ? !!c.topic : topic !== ALL && c.topic !== topic) continue;
      const found = byChannel.get(c.id);
      if (!found) continue;
      found.sort((a, b) => b.publishedAt - a.publishedAt);
      const shown = found.slice(0, MAX_PER_CHANNEL);
      const prev = keptItems.current.get(c.id);
      const same = prev && prev.length === shown.length && prev.every((x, i) => x === shown[i]);
      const items = same ? prev : shown;
      keptItems.current.set(c.id, items);
      out.push({ channel: c, items, total: found.length });
    }
    return out;
  }, [channels, feed, topic, query]);

  const add = async (value: string) => {
    setAdding(false);
    setBusy(true);
    try {
      const c = await addChannelFrom(value);
      notify("Канал додано", c.name);
    } catch (e) {
      notify("Не вдалося додати канал", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // «+»: by a link, or picked from the user's own YouTube subscriptions (signing in to Google first if needed).
  const addMenu = async () => {
    const key = await ask({
      title: "Додати канал",
      answers: [
        { key: "link", label: "За посиланням", primary: !signedIn },
        { key: "subs", label: signedIn ? "З моїх підписок YouTube" : "Увійти через Google і вибрати з підписок", primary: signedIn },
        ...(signedIn ? [{ key: "out", label: "Вийти з Google" }] : []),
      ],
    });
    if (key === "link") setAdding(true);
    else if (key === "out") signOutOfGoogle();
    else if (key === "subs") {
      try {
        if (!isSignedIn() && !(await signInWithGoogle())) return;
        router.push("/import-subscriptions");
      } catch (e) {
        notify("Не вдалося увійти через Google", errorMessage(e));
      }
    }
  };

  const channelMenu = useCallback(async (c: Channel) => {
    const key = await ask({
      title: c.name,
      answers: [
        { key: "topic", label: c.topic ? `Тема: ${c.topic}` : "Задати тему", primary: true },
        ...(c.topic ? [{ key: "untopic", label: "Прибрати з теми" }] : []),
        { key: "auto", label: c.autoWant ? "Не додавати нові відео самі" : "Нові відео самі в «Хочу»" },
        { key: "remove", label: "Прибрати канал", destructive: true },
      ],
    });
    if (key === "topic") {
      // Pick one of the topics that already exist, or make a new one.
      const existing = Array.from(new Set(useChannelsStore.getState().channels.map((x) => x.topic).filter((t): t is string => !!t)));
      if (existing.length === 0) return setTopicFor(c);
      const picked = await ask({
        title: "Тема каналу",
        answers: [
          ...existing.map((t, i) => ({ key: `t${i}`, label: t === c.topic ? `✓ ${t}` : t })),
          { key: "new", label: "Нова тема…", primary: true },
        ],
      });
      if (picked === "new") setTopicFor(c);
      else if (picked) updateChannel(c.id, { topic: existing[Number(picked.slice(1))] });
    }
    else if (key === "untopic") updateChannel(c.id, { topic: null });
    else if (key === "auto") updateChannel(c.id, { autoWant: !c.autoWant });
    else if (key === "remove") removeChannel(c.id);
  }, [updateChannel, removeChannel]);

  // A tap opens the watch screen: the video on top, this channel's other videos under it.
  const watchNow = useCallback((item: FeedItem) => router.push({ pathname: "/watch-channel", params: { yt: item.id, ch: item.channelId } }), []);

  return (
    <View style={[styles.root, { backgroundColor: S.bg }]}>
      <FlatList
        data={groups}
        keyExtractor={(g) => g.channel.id}
        renderItem={({ item: g }) => (
          <ChannelShelf
            channel={g.channel}
            items={g.items}
            total={g.total}
            tileWidth={tileWidth}
            onMenu={channelMenu}
            onOpen={watchNow}
            onNo={setItemState}
          />
        )}
        // Only the shelves on (and near) the screen are built; the rest as they scroll in.
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        updateCellsBatchingPeriod={60}
        windowSize={5}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={doRefresh} progressViewOffset={topBarSpace(insets.top)} />}
        contentContainerStyle={{ paddingTop: topBarSpace(insets.top), paddingBottom: DOCK_CLEARANCE + insets.bottom + 24 }}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 10 }}>
            {topics.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.caps}>
                {hasUntopiced && <Pill label="Без теми" selected={topic === NONE} onPress={() => setTopic(NONE)} />}
                {topics.map((t) => (
                  <Pill key={t} label={t} selected={topic === t} onPress={() => setTopic(t)} />
                ))}
                <Pill label="Усі" selected={topic === ALL} onPress={() => setTopic(ALL)} />
              </ScrollView>
            )}
            {busy && (
              <View style={styles.busy}>
                <ActivityIndicator color={S.ink2} />
                <Text style={[TYPE.meta, { color: S.ink2 }]}>Шукаю канал…</Text>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          busy ? null : channels.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="tv-outline" size={30} color={S.ink3} />
              <Text style={[TYPE.row, { color: S.ink3, textAlign: "center" }]}>
                Натисніть «+» і вставте посилання на канал, його @назву або будь-яке його відео. Нові відео каналу з'являться тут.
              </Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={[TYPE.row, { color: S.ink3, textAlign: "center" }]}>
                {refreshing ? "Шукаю нові відео…" : "Нових відео немає. Потягніть вниз, щоб оновити."}
              </Text>
            </View>
          )
        }
      />

      <EdgeFade edge="top" color={S.bg} height={topBarSpace(insets.top) + 14} />
      <TopBar title="Канали" icon="tv-outline" />

      <DeskDock
        desk="channels"
        onDesk={(k) => goDesk("channels", k)}
        query={query}
        onChangeQuery={setQuery}
        onAdd={addMenu}
        bead={{ icon: "settings-outline", label: "Налаштування", onPress: () => router.push("/settings") }}
      />

      <NamePrompt
        visible={adding}
        title="Додати канал"
        placeholder="Посилання на канал, @назва або відео"
        onCancel={() => setAdding(false)}
        onSave={add}
      />
      <NamePrompt
        visible={topicFor !== null}
        title="Тема каналу"
        placeholder="Наприклад: Дизайн"
        initialValue={topicFor?.topic ?? ""}
        onCancel={() => setTopicFor(null)}
        onSave={(t) => {
          if (topicFor) updateChannel(topicFor.id, { topic: t.trim() });
          setTopicFor(null);
        }}
      />
    </View>
  );
}

// One channel: its header and its shelf. Memoized - it is redrawn only when ITS videos change.
const ChannelShelf = memo(function ChannelShelf({
  channel,
  items,
  total,
  tileWidth,
  onMenu,
  onOpen,
  onNo,
}: {
  channel: Channel;
  items: FeedItem[];
  total: number;
  tileWidth: number;
  onMenu: (c: Channel) => void;
  onOpen: (item: FeedItem) => void;
  onNo: (id: string, state: FeedItem["state"]) => void;
}) {
  const S = useSoft();
  const renderTile = useCallback(
    (item: FeedItem) => (
      <Tile item={item} onOpen={() => onOpen(item)} onWant={() => wantVideo(item, channel.name)} onNo={() => onNo(item.id, "dismissed")} />
    ),
    [channel.name, onOpen, onNo]
  );
  return (
    <View style={{ gap: 10, marginBottom: 10 }}>
      <Pressable onLongPress={() => onMenu(channel)} delayLongPress={350} onPress={() => onMenu(channel)} style={styles.chHead}>
        {channel.avatarUrl ? (
          <Image source={{ uri: channel.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: S.fillSolid }]}>
            <Text style={[TYPE.meta, { color: S.ink2 }]}>{channel.name.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <Text style={[TYPE.cardTitle, { color: S.ink, flex: 1 }]} numberOfLines={1}>
          {channel.name}
        </Text>
        <Text style={[TYPE.meta, { color: S.ink3 }]}>{total}</Text>
        {channel.autoWant ? <Ionicons name="heart" size={14} color={S.accent} /> : null}
        <Ionicons name="ellipsis-horizontal" size={18} color={S.ink3} />
      </Pressable>
      <ShelfRow items={items} tileWidth={tileWidth} padding={SIDE} keyOf={keyOfItem} renderTile={renderTile} />
    </View>
  );
});

const keyOfItem = (item: FeedItem) => item.id;

// One video on a shelf: the picture, the title, how long ago, and the two answers.
function Tile({ item, onOpen, onWant, onNo }: { item: FeedItem; onOpen: () => void; onWant: () => void; onNo: () => void }) {
  const S = useSoft();
  return (
    <View style={[styles.tile, { backgroundColor: S.card, boxShadow: S.shadow }]}>
      <Pressable onPress={onOpen} style={{ gap: 8 }}>
        <View style={[styles.thumb, { backgroundColor: S.fillSolid }]}>
          <Image source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} />
        </View>
        <Text style={[styles.title, { color: S.ink }]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={[TYPE.small, { color: S.ink3 }]}>{ago(item.publishedAt)}</Text>
      </Pressable>
      <View style={styles.acts}>
        <Pressable onPress={onWant} style={[styles.act, { backgroundColor: S.ink }]} accessibilityLabel="Хочу">
          <Ionicons name="heart-outline" size={16} color={S.chrome} />
          <Text style={[TYPE.meta, { color: S.chrome, fontFamily: FONT.semibold }]}>Хочу</Text>
        </Pressable>
        <Pressable onPress={onNo} style={[styles.act, { backgroundColor: S.fill }]} accessibilityLabel="Не цікаво">
          <Ionicons name="close" size={16} color={S.ink2} />
          <Text style={[TYPE.meta, { color: S.ink2, fontFamily: FONT.semibold }]}>Не цікаво</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  caps: { paddingHorizontal: SIDE, gap: 8 },
  busy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 8 },
  empty: { alignItems: "center", gap: 10, paddingHorizontal: 40, paddingTop: 90 },
  chHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: SIDE, marginTop: 6 },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  tile: { padding: 10, borderRadius: RADIUS.row, gap: 10 },
  thumb: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, overflow: "hidden" },
  title: { fontFamily: FONT.semibold, fontWeight: "normal", fontSize: 14, lineHeight: 18, letterSpacing: -0.15 },
  acts: { flexDirection: "row", gap: 8 },
  act: { height: 34, borderRadius: 17, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 5 },
});
