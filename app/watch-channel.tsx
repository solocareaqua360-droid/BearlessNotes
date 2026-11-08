import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@/components/icons/Ionicons";
import { DOCK_CLEARANCE, Dock } from "@/components/ui/Dock";
import { wantVideo } from "@/services/channels";
import { useChannelsStore } from "@/store/useChannelsStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { FONT, RADIUS, SIDE, TYPE, useSoft } from "@/theme/soft";
import { shareVideoLink } from "@/utils/shareLink";
import { timeAgo } from "@/utils/timeAgo";
import { watchBox } from "@/utils/watchLayout";

// THE WATCH SCREEN FOR A CHANNEL'S VIDEO (not in the library yet): the video at
// the top, under it the title, the channel and «Хочу» (takes it into the
// library), «Поділитися», and then the OTHER videos of this same channel as
// cards - a tap on one plays it here. Same bones as the library's watch screen.
export default function WatchChannelScreen() {
  const { yt, ch } = useLocalSearchParams<{ yt?: string; ch?: string }>();
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const channels = useChannelsStore((s) => s.channels);
  const feed = useChannelsStore((s) => s.feed);

  const item = useMemo(() => feed.find((f) => f.id === yt), [feed, yt]);
  const channel = useMemo(() => channels.find((c) => c.id === ch), [channels, ch]);
  const [query, setQuery] = useState("");

  // The video was CLOSED: an empty watch screen is no place to stay.
  const opened = useRef(false);
  const playerUrl = usePlayerStore((st) => st.url);
  useEffect(() => {
    if (opened.current && !playerUrl) router.back();
  }, [playerUrl]);

  // The player shows THIS video: continue it if it is already playing, else start it.
  useEffect(() => {
    if (!item) return;
    const p = usePlayerStore.getState();
    if (p.ytId === item.id && p.url) p.setMode("watch");
    else p.open(`https://www.youtube.com/watch?v=${item.id}`, item.title, { ytId: item.id, channelId: item.channelId, mode: "watch" });
    opened.current = true;
    // Only when a different video is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // However this screen goes away, the video drops to the small window.
  useEffect(
    () => () => {
      const p = usePlayerStore.getState();
      if (p.mode === "watch") p.minimize();
    },
    []
  );

  const goBack = useCallback(() => {
    usePlayerStore.getState().minimize();
    router.back();
  }, []);
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        goBack();
        return true;
      });
      return () => sub.remove();
    }, [goBack])
  );

  // A video that is gone (channel removed): nothing to watch.
  useEffect(() => {
    if (yt && !item) router.back();
  }, [yt, item]);

  const others = useMemo(() => {
    if (!item) return [];
    const needle = query.trim().toLowerCase();
    return feed
      .filter((f) => f.channelId === item.channelId && f.id !== item.id && f.state !== "dismissed")
      .filter((f) => !needle || f.title.toLowerCase().includes(needle))
      .sort((a, b) => b.publishedAt - a.publishedAt);
  }, [feed, item, query]);

  if (!item) return <View style={[styles.root, { backgroundColor: S.bg }]} />;

  const box = watchBox(width, height, insets.top, true);
  const inLibrary = item.state === "want";
  const open = (id2: string) => router.setParams({ yt: id2, ch: item.channelId });

  return (
    <View style={[styles.root, { backgroundColor: S.bg }]}>
      <StatusBar style="light" />
      <View style={[styles.block, { height: box.blockH }]} />

      <KeyboardAwareScrollView
        bottomOffset={24}
        style={{ marginTop: box.blockH }}
        contentContainerStyle={{ paddingTop: 14, paddingBottom: DOCK_CLEARANCE + insets.bottom, gap: 10 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pad}>
          <Text style={[styles.title, { color: S.ink }]}>{item.title}</Text>
          <Text style={[TYPE.meta, { color: S.ink3, marginTop: 4 }]}>
            YouTube · {timeAgo(item.publishedAt)}
          </Text>
        </View>

        <View style={[styles.pad, styles.who]}>
          {channel?.avatarUrl ? (
            <Image source={{ uri: channel.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: S.fillSolid, alignItems: "center", justifyContent: "center" }]}>
              <Text style={[TYPE.meta, { color: S.ink2 }]}>{(channel?.name ?? "?").slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <Text style={[TYPE.row, { flex: 1, color: S.ink, fontFamily: FONT.semibold }]} numberOfLines={1}>
            {channel?.name ?? "Канал"}
          </Text>
          <Pressable
            onPress={() => !inLibrary && wantVideo(item, channel?.name ?? "")}
            style={[styles.want, { backgroundColor: inLibrary ? S.fillSolid : S.ink }]}
            accessibilityLabel="Хочу"
          >
            <Ionicons name={inLibrary ? "checkmark" : "heart-outline"} size={16} color={inLibrary ? S.ink2 : S.chrome} />
            <Text style={[TYPE.meta, { color: inLibrary ? S.ink2 : S.chrome, fontFamily: FONT.semibold }]}>{inLibrary ? "У бібліотеці" : "Хочу"}</Text>
          </Pressable>
        </View>

        <View style={[styles.pad, styles.pills]}>
          <Pressable
            onPress={() => shareVideoLink(`https://www.youtube.com/watch?v=${item.id}`, item.title)}
            style={[styles.pill, { backgroundColor: S.fill }]}
          >
            <Ionicons name="share-outline" size={17} color={S.ink} />
            <Text style={[TYPE.meta, { color: S.ink, fontFamily: FONT.semibold }]}>Поділитися</Text>
          </Pressable>
        </View>

        <View style={[styles.pad, { gap: 10, marginTop: 4 }]}>
          {others.map((v) => (
            <Pressable key={v.id} onPress={() => open(v.id)} style={[styles.row, { backgroundColor: S.card, boxShadow: S.shadow }]}>
              <View style={[styles.thumb, { backgroundColor: S.fillSolid }]}>
                <Image source={{ uri: v.thumbnailUrl }} style={StyleSheet.absoluteFill} />
              </View>
              <View style={styles.body}>
                <Text style={[styles.rowTitle, { color: S.ink }]} numberOfLines={2}>
                  {v.title}
                </Text>
                <Text style={[TYPE.small, { color: S.ink3 }]}>{timeAgo(v.publishedAt)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </KeyboardAwareScrollView>

      <Dock
        query={query}
        onChangeQuery={setQuery}
        onAdd={() => router.push("/add-video")}
        bead={{ icon: "chevron-back", label: "Назад", onPress: goBack }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  block: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: "#000" },
  pad: { paddingHorizontal: SIDE },
  title: { fontFamily: FONT.bold, fontWeight: "normal", fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  who: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  want: { height: 36, borderRadius: 18, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 6 },
  pills: { flexDirection: "row", gap: 8 },
  pill: { height: 38, borderRadius: 19, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 7 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: RADIUS.row },
  thumb: { width: 112, aspectRatio: 16 / 9, borderRadius: 12, overflow: "hidden", flexShrink: 0 },
  body: { flex: 1, minWidth: 0, gap: 4 },
  rowTitle: { fontFamily: FONT.semibold, fontWeight: "normal", fontSize: 14, lineHeight: 18, letterSpacing: -0.15 },
});
