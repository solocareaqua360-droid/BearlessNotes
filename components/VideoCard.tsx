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
  onLongPress?: () => void;
  layout?: "grid" | "list";
  selectable?: boolean;
  selected?: boolean;
}

export function VideoCard({
  video,
  tags,
  onPress,
  onLongPress,
  layout = "grid",
  selectable = false,
  selected = false,
}: VideoCardProps) {
  const isList = layout === "list";

  return (
    <Pressable
      style={[styles.card, isList && styles.cardList]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View style={[styles.thumbnailWrap, isList && styles.thumbnailWrapList]}>
        {video.thumbnailUrl ? (
          <Image source={{ uri: video.thumbnailUrl }} style={styles.thumbnail} />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailPlaceholder]} />
        )}

        <View style={[styles.playButton, isList && styles.playButtonSmall]}>
          <Ionicons name="play" size={isList ? 12 : 22} color="#fff" style={{ marginLeft: 2 }} />
        </View>

        <View style={[styles.durationBadge, isList && styles.durationBadgeSmall]}>
          <Text style={[styles.durationText, isList && styles.durationTextSmall]}>
            {formatDuration(video.durationSec)}
          </Text>
        </View>

        {selectable && (
          <View style={[styles.selectCircle, selected && styles.selectCircleActive]}>
            {selected && <Ionicons name="checkmark" size={14} color={colors.iconDark} />}
          </View>
        )}
      </View>

      <View style={[styles.body, isList && styles.bodyList]}>
        <Text style={[styles.title, isList && styles.titleList]} numberOfLines={2}>
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
  cardList: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.md,
    overflow: "visible",
  },
  thumbnailWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
    position: "relative",
    overflow: "hidden",
  },
  thumbnailWrapList: {
    width: 104,
    borderRadius: radius.sm,
    flexShrink: 0,
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
  playButtonSmall: {
    marginTop: -13,
    marginLeft: -13,
    width: 26,
    height: 26,
    borderRadius: 13,
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
  durationBadgeSmall: {
    right: 5,
    bottom: 5,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
  },
  durationText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  durationTextSmall: {
    fontSize: 10,
  },
  selectCircle: {
    position: "absolute",
    top: 8,
    left: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#fff",
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  selectCircleActive: {
    backgroundColor: colors.neutralActive,
    borderColor: colors.neutralActive,
  },
  body: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  bodyList: {
    flex: 1,
    padding: 0,
    gap: 6,
    minWidth: 0,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  titleList: {
    fontSize: 14,
    lineHeight: 18,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
});
