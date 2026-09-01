import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { TagChip } from "@/components/TagChip";
import { colors, radius, spacing } from "@/constants/theme";
import { formatDuration } from "@/store/useLibraryStore";
import { Tag, Video } from "@/types";

interface VideoCardProps {
  video: Video;
  tags: Tag[];
  onPress: () => void;
}

export function VideoCard({ video, tags, onPress }: VideoCardProps) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.thumbnailWrap}>
        {video.thumbnailUrl ? (
          <Image source={{ uri: video.thumbnailUrl }} style={styles.thumbnail} />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailPlaceholder]} />
        )}

        <View style={styles.playButton}>
          <Ionicons name="play" size={22} color="#fff" style={{ marginLeft: 2 }} />
        </View>

        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>{formatDuration(video.durationSec)}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {video.title}
        </Text>

        {tags.length > 0 && (
          <View style={styles.tagRow}>
            {tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} compact />
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  thumbnailWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
  },
  thumbnail: {
    width: "100%",
    height: "100%",
  },
  thumbnailPlaceholder: {
    backgroundColor: colors.surfaceElevated,
  },
  playButton: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -24,
    marginLeft: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  durationBadge: {
    position: "absolute",
    right: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  durationText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  body: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
});
