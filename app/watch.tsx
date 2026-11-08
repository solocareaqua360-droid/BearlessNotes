import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@/components/icons/Ionicons";
import { VideoCard } from "@/components/VideoCard";
import { DOCK_CLEARANCE, Dock } from "@/components/ui/Dock";
import { formatStamp, resumePoint, sortVideos, useLibraryStore } from "@/store/useLibraryStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { FONT, RADIUS, SIDE, softCursor, TYPE, useScheme, useSoft } from "@/theme/soft";
import { shareVideoLink } from "@/utils/shareLink";
import { getVideoEmbedInfo } from "@/utils/videoEmbed";
import { watchBox } from "@/utils/watchLayout";

// THE WATCH SCREEN: the video at the top (drawn by PlayerHost, above every
// screen, into the box reserved here), under it the title and what the old
// card held - status, folder, share, comment - and then the OTHER videos of
// the same folder as ordinary cards. Back leaves the screen and the video
// plays on in the strip.
export default function WatchScreen() {
  const { id, folder } = useLocalSearchParams<{ id?: string; folder?: string }>();
  const S = useSoft();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const videos = useLibraryStore((s) => s.videos);
  const tags = useLibraryStore((s) => s.tags);
  const updateVideo = useLibraryStore((s) => s.updateVideo);

  const video = useMemo(() => videos.find((v) => v.id === id), [videos, id]);
  const [query, setQuery] = useState("");
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState("");
  // While the comment is being typed the keyboard needs the room: no dock.
  const [commentFocused, setCommentFocused] = useState(false);

  // The video was CLOSED (the cross, from the watch box or from full screen):
  // an empty watch screen is no place to stay.
  const opened = useRef(false);
  const playerUrl = usePlayerStore((st) => st.url);
  useEffect(() => {
    if (opened.current && !playerUrl) router.back();
  }, [playerUrl]);

  // The player shows THIS video: continue it if it is already playing (coming
  // back from the strip), else start it.
  useEffect(() => {
    if (!video) return;
    const p = usePlayerStore.getState();
    if (p.videoId === video.id && p.url) p.setMode("watch");
    else p.open(video.url, video.title, { videoId: video.id, folderId: folder || null, mode: "watch", start: resumePoint(video) });
    opened.current = true;
    setComment(video.comment);
    setCommentOpen(false);
    // Only when a different video is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id]);

  // The comment closed (its field is gone, so no blur ever arrives): the dock is back.
  useEffect(() => {
    if (!commentOpen) setCommentFocused(false);
  }, [commentOpen]);

  // However this screen goes away, the video does not stay stuck "in the
  // watch box" with nothing under it: it drops to the strip.
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

  // A video that is gone (deleted, bad link): nothing to watch.
  useEffect(() => {
    if (id && !video) router.back();
  }, [id, video]);

  const folderId = folder || null;
  const others = useMemo(() => {
    if (!video) return [];
    let list = videos.filter((v) => v.id !== video.id && (folderId ? v.tagIds.includes(folderId) : v.tagIds.length === 0));
    const needle = query.trim().toLowerCase();
    if (needle) list = list.filter((v) => v.title.toLowerCase().includes(needle) || (v.siteName ?? "").toLowerCase().includes(needle));
    return sortVideos(list, "createdAt", "desc");
  }, [videos, video, folderId, query]);

  if (!video) return <View style={[styles.root, { backgroundColor: S.bg }]} />;

  const wide = getVideoEmbedInfo(video.url)?.provider !== "tiktok";
  const box = watchBox(width, height, insets.top, wide);
  const videoTags = tags.filter((t) => video.tagIds.includes(t.id));
  const firstTag = videoTags[0];
  const site = video.siteName || (video.source === "youtube" ? "YouTube" : video.source === "tiktok" ? "TikTok" : "");
  const watched = video.status === "watched";

  const toggleStatus = () => {
    Haptics.selectionAsync().catch(() => {});
    updateVideo(video.id, { status: watched ? "planned" : "watched" });
  };
  const saveComment = () => {
    if (comment !== video.comment) updateVideo(video.id, { comment });
  };
  const open = (id2: string) => router.setParams({ id: id2, folder: folder ?? "" });

  return (
    <View style={[styles.root, { backgroundColor: S.bg }]}>
      <StatusBar style="light" />
      {/* Under the player (and the status bar): black, like the picture. */}
      <View style={[styles.block, { height: box.blockH }]} />

      <KeyboardAwareScrollView
        bottomOffset={24}
        style={{ marginTop: box.blockH }}
        contentContainerStyle={{ paddingTop: 14, paddingBottom: DOCK_CLEARANCE + insets.bottom, gap: 10 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pad}>
          <Text style={[styles.title, { color: S.ink }]}>{video.title}</Text>
          <Text style={[TYPE.meta, { color: S.ink3, marginTop: 4 }]}>
            {site ? `${site} · ` : ""}
            {formatStamp(video.createdAt)}
          </Text>
        </View>

        <View style={[styles.pad, styles.who]}>
          <View style={[styles.folderIcon, { backgroundColor: firstTag ? `${firstTag.color}24` : S.fill }]}>
            <Ionicons name={(firstTag?.icon ?? "folder-outline") as any} size={19} color={firstTag?.color ?? S.ink2} />
          </View>
          <Text style={[TYPE.row, { flex: 1, color: S.ink, fontFamily: FONT.semibold }]} numberOfLines={1}>
            {firstTag ? videoTags.map((t) => t.name).join(", ") : "Без папки"}
          </Text>
          <Pressable onPress={toggleStatus} style={[styles.status, { backgroundColor: S.ink }]} accessibilityLabel="Змінити статус">
            <Text style={[TYPE.meta, { color: S.chrome, fontFamily: FONT.semibold }]}>{watched ? "Переглянуто" : "Планую"}</Text>
            <Ionicons name="chevron-down" size={14} color={S.chrome} />
          </Pressable>
        </View>

        <View style={[styles.pad, styles.pills]}>
          <Pressable onPress={() => shareVideoLink(video.url, video.title)} style={[styles.pill, { backgroundColor: S.fill }]}>
            <Ionicons name="share-outline" size={17} color={S.ink} />
            <Text style={[TYPE.meta, { color: S.ink, fontFamily: FONT.semibold }]}>Поділитися</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (commentOpen) saveComment();
              setCommentOpen(!commentOpen);
            }}
            style={[styles.pill, { backgroundColor: commentOpen ? S.fillSolid : S.fill }]}
          >
            <Ionicons name="chatbubble-outline" size={16} color={S.ink} />
            <Text style={[TYPE.meta, { color: S.ink, fontFamily: FONT.semibold }]}>Коментар</Text>
            {video.comment ? <View style={[styles.dot, { backgroundColor: S.accent }]} /> : null}
          </Pressable>
        </View>

        {commentOpen && (
          <View style={styles.pad}>
            <TextInput
              value={comment}
              onChangeText={setComment}
              onFocus={() => setCommentFocused(true)}
              onBlur={() => {
                setCommentFocused(false);
                saveComment();
              }}
              placeholder="Додати коментар…"
              placeholderTextColor={S.ink3}
              multiline
              autoFocus={!video.comment}
              style={[styles.commentInput, { color: S.ink, backgroundColor: S.fill }]}
              {...softCursor(scheme)}
            />
          </View>
        )}

        <View style={[styles.pad, { gap: 10, marginTop: 4 }]}>
          {others.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              tags={tags.filter((t) => v.tagIds.includes(t.id))}
              layout="list"
              onPress={() => open(v.id)}
              onToggleStatus={() => updateVideo(v.id, { status: v.status === "planned" ? "watched" : "planned" })}
            />
          ))}
        </View>
      </KeyboardAwareScrollView>

      {!commentFocused && (
      <Dock
        query={query}
        onChangeQuery={setQuery}
        onAdd={() => router.push("/add-video")}
        bead={{ icon: "chevron-back", label: "Назад", onPress: goBack }}
      />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  block: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: "#000" },
  pad: { paddingHorizontal: SIDE },
  title: { fontFamily: FONT.bold, fontWeight: "normal", fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  who: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  folderIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  status: { height: 36, borderRadius: 18, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 5 },
  pills: { flexDirection: "row", gap: 8 },
  pill: { height: 38, borderRadius: 19, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  commentInput: {
    borderRadius: RADIUS.row,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 96,
    textAlignVertical: "top",
    fontFamily: FONT.regular,
    fontWeight: "normal",
    fontSize: 16,
    lineHeight: 24,
  },
});
