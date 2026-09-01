import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StatusToggle } from "@/components/StatusToggle";
import { TagChip } from "@/components/TagChip";
import { colors, radius, spacing } from "@/constants/theme";
import { useLibraryStore } from "@/store/useLibraryStore";

export default function VideoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const videos = useLibraryStore((s) => s.videos);
  const tags = useLibraryStore((s) => s.tags);
  const updateVideo = useLibraryStore((s) => s.updateVideo);

  const video = useMemo(() => videos.find((v) => v.id === id), [videos, id]);
  const videoTags = useMemo(
    () => tags.filter((t) => video?.tagIds.includes(t.id)),
    [tags, video]
  );

  const [comment, setComment] = useState(video?.comment ?? "");

  if (!video) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.notFound}>Відео не знайдено</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Відео</Text>
        <Pressable onPress={() => Linking.openURL(video.url)} hitSlop={8}>
          <Ionicons name="open-outline" size={20} color={colors.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.playerWrap}>
        {video.thumbnailUrl ? (
          <Image source={{ uri: video.thumbnailUrl }} style={styles.player} />
        ) : (
          <View style={[styles.player, styles.playerPlaceholder]} />
        )}
        <View style={styles.playButton}>
          <Ionicons name="play" size={30} color="#fff" style={{ marginLeft: 3 }} />
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>{video.title}</Text>

        <StatusToggle
          value={video.status}
          onChange={(status) => updateVideo(video.id, { status })}
        />

        <View style={styles.tagsRow}>
          {videoTags.map((tag) => (
            <TagChip key={tag.id} tag={tag} />
          ))}
          <Pressable style={styles.addTagButton} onPress={() => router.push("/tag-editor")}>
            <Ionicons name="add" size={16} color={colors.textSecondary} />
            <Text style={styles.addTagLabel}>Додати тег</Text>
          </Pressable>
        </View>

        <TextInput
          value={comment}
          onChangeText={(text) => {
            setComment(text);
            updateVideo(video.id, { comment: text });
          }}
          placeholder="Коментар…"
          placeholderTextColor={colors.textMuted}
          style={styles.comment}
          multiline
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  notFound: {
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: spacing.xxl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  playerWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
  },
  player: {
    width: "100%",
    height: "100%",
  },
  playerPlaceholder: {
    backgroundColor: colors.surfaceElevated,
  },
  playButton: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -30,
    marginLeft: -30,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignItems: "center",
  },
  addTagButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addTagLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  comment: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: 13,
    minHeight: 72,
    textAlignVertical: "top",
  },
});
