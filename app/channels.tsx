import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
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
import { errorMessage } from "@/services/errorMessage";
import { useChannelsStore, type Channel, type FeedItem } from "@/store/useChannelsStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { FONT, RADIUS, SIDE, TYPE, useSoft } from "@/theme/soft";
import { goDesk } from "@/utils/desks";

// «КАНАЛИ»: the channels the user follows, what is NEW in them, grouped by
// channel. Each new video can be taken («♡ Хочу» - it goes into the library as
// «Планую») or waved away («✕ Не цікаво» - it is never offered again). The
// capsules at the top are the topics the channels are filed under.
const ALL = "__all__";
const MAX_PER_CHANNEL = 12;

function ago(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return "сьогодні";
  if (d === 1) return "вчора";
  if (d < 7) return `${d} дн. тому`;
  if (d < 30) return `${Math.floor(d / 7)} тиж. тому`;
  if (d < 365) return `${Math.floor(d / 30)} міс. тому`;
  return `${Math.floor(d / 365)} р. тому`;
}

export default function ChannelsScreen() {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // A tile is about half the screen wide: several shelves fit one screen, and the next tile peeks in from behind.
  const tileWidth = Math.min(250, Math.round(width * 0.52));
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
  useEffect(() => {
    if (topic !== ALL && !topics.includes(topic)) setTopic(ALL);
  }, [topic, topics]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return channels
      .filter((c) => topic === ALL || c.topic === topic)
      .map((c) => ({
        channel: c,
        items: feed
          .filter((f) => f.channelId === c.id && f.state === "new" && (!needle || f.title.toLowerCase().includes(needle)))
          .sort((a, b) => b.publishedAt - a.publishedAt),
      }))
      .filter((g) => g.items.length > 0);
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

  const channelMenu = async (c: Channel) => {
    const key = await ask({
      title: c.name,
      answers: [
        { key: "topic", label: c.topic ? `Тема: ${c.topic}` : "Задати тему", primary: true },
        ...(c.topic ? [{ key: "untopic", label: "Прибрати з теми" }] : []),
        { key: "auto", label: c.autoWant ? "Не додавати нові відео самі" : "Нові відео самі в «Хочу»" },
        { key: "remove", label: "Прибрати канал", destructive: true },
      ],
    });
    if (key === "topic") setTopicFor(c);
    else if (key === "untopic") updateChannel(c.id, { topic: null });
    else if (key === "auto") updateChannel(c.id, { autoWant: !c.autoWant });
    else if (key === "remove") removeChannel(c.id);
  };

  const watchNow = (item: FeedItem) =>
    usePlayerStore.getState().open(`https://www.youtube.com/watch?v=${item.id}`, item.title, { mode: "full" });

  return (
    <View style={[styles.root, { backgroundColor: S.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={doRefresh} progressViewOffset={topBarSpace(insets.top)} />}
        contentContainerStyle={{ paddingTop: topBarSpace(insets.top), paddingBottom: DOCK_CLEARANCE + insets.bottom + 24, gap: 10 }}
      >
        {topics.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.caps}>
            <Pill label="Усі" selected={topic === ALL} onPress={() => setTopic(ALL)} />
            {topics.map((t) => (
              <Pill key={t} label={t} selected={topic === t} onPress={() => setTopic(t)} />
            ))}
          </ScrollView>
        )}

        {busy && (
          <View style={styles.busy}>
            <ActivityIndicator color={S.ink2} />
            <Text style={[TYPE.meta, { color: S.ink2 }]}>Шукаю канал…</Text>
          </View>
        )}

        {channels.length === 0 && !busy ? (
          <View style={styles.empty}>
            <Ionicons name="tv-outline" size={30} color={S.ink3} />
            <Text style={[TYPE.row, { color: S.ink3, textAlign: "center" }]}>
              Натисніть «+» і вставте посилання на канал, його @назву або будь-яке його відео. Нові відео каналу з'являться тут.
            </Text>
          </View>
        ) : groups.length === 0 && !busy ? (
          <View style={styles.empty}>
            <Text style={[TYPE.row, { color: S.ink3, textAlign: "center" }]}>
              {refreshing ? "Шукаю нові відео…" : "Нових відео немає. Потягніть вниз, щоб оновити."}
            </Text>
          </View>
        ) : (
          groups.map(({ channel, items }) => (
            <View key={channel.id} style={{ gap: 10 }}>
              <Pressable onLongPress={() => channelMenu(channel)} delayLongPress={350} onPress={() => channelMenu(channel)} style={styles.chHead}>
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
                <Text style={[TYPE.meta, { color: S.ink3 }]}>{items.length}</Text>
                {channel.autoWant ? <Ionicons name="heart" size={14} color={S.accent} /> : null}
                <Ionicons name="ellipsis-horizontal" size={18} color={S.ink3} />
              </Pressable>
              <ShelfRow
                items={items.slice(0, MAX_PER_CHANNEL)}
                tileWidth={tileWidth}
                padding={SIDE}
                keyOf={(item) => item.id}
                renderTile={(item) => (
                  <Tile
                    item={item}
                    onOpen={() => watchNow(item)}
                    onWant={() => wantVideo(item, channel.name)}
                    onNo={() => setItemState(item.id, "dismissed")}
                  />
                )}
              />
            </View>
          ))
        )}
      </ScrollView>

      <EdgeFade edge="top" color={S.bg} height={topBarSpace(insets.top) + 14} />
      <TopBar title="Канали" icon="tv-outline" />

      <DeskDock
        desk="channels"
        onDesk={(k) => goDesk("channels", k)}
        query={query}
        onChangeQuery={setQuery}
        onAdd={() => setAdding(true)}
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
