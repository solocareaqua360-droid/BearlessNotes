import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StatusToggle } from "@/components/StatusToggle";
import { TagChip } from "@/components/TagChip";
import { colors, radius, spacing } from "@/constants/theme";
import { fetchVideoMeta, VideoMeta } from "@/services/videoMeta";
import { useLibraryStore } from "@/store/useLibraryStore";
import { WatchStatus } from "@/types";

export default function AddVideoScreen() {
  const tags = useLibraryStore((s) => s.tags);
  const addVideo = useLibraryStore((s) => s.addVideo);

  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [status, setStatus] = useState<WatchStatus>("planned");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleUrlChange = async (text: string) => {
    setUrl(text);
    if (text.trim().length < 8) {
      setMeta(null);
      return;
    }
    setLoading(true);
    try {
      const result = await fetchVideoMeta(text.trim());
      setMeta(result);
    } finally {
      setLoading(false);
    }
  };

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((tagId) => tagId !== id) : [...prev, id]
    );
  };

  const handleSave = () => {
    if (!url.trim()) return;
    addVideo({
      id: `v-${Date.now()}`,
      url: url.trim(),
      title: meta?.title ?? "Нове відео",
      thumbnailUrl: meta?.thumbnailUrl ?? "",
      durationSec: meta?.durationSec ?? 0,
      source: meta?.source ?? "unknown",
      status,
      tagIds: selectedTagIds,
      comment: "",
      createdAt: Date.now(),
    });
    router.back();
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.headerAction}>Скасувати</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Нове відео</Text>
        <Pressable onPress={handleSave} disabled={!url.trim()}>
          <Text style={[styles.headerAction, styles.headerSave, !url.trim() && styles.disabled]}>
            Зберегти
          </Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        <TextInput
          value={url}
          onChangeText={handleUrlChange}
          placeholder="Встав посилання на YouTube або TikTok"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {(meta || loading) && (
          <View style={styles.previewCard}>
            <View style={styles.previewThumbWrap}>
              {meta?.thumbnailUrl ? (
                <Image source={{ uri: meta.thumbnailUrl }} style={styles.previewThumb} />
              ) : (
                <View style={[styles.previewThumb, styles.previewThumbPlaceholder]} />
              )}
            </View>
            <View style={styles.previewBody}>
              <Text style={styles.previewTitle} numberOfLines={2}>
                {loading ? "Завантаження…" : meta?.title}
              </Text>
            </View>
          </View>
        )}

        <StatusToggle value={status} onChange={setStatus} />

        <View style={styles.tagsSection}>
          <View style={styles.tagsRow}>
            {tags.map((tag) => {
              const selected = selectedTagIds.includes(tag.id);
              return (
                <Pressable key={tag.id} onPress={() => toggleTag(tag.id)} style={selected && styles.tagSelected}>
                  <TagChip tag={tag} />
                </Pressable>
              );
            })}
            <Pressable
              style={styles.addTagButton}
              onPress={() => router.push("/tag-editor")}
            >
              <Ionicons name="add" size={16} color={colors.textSecondary} />
              <Text style={styles.addTagLabel}>Новий тег</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  headerAction: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  headerSave: {
    color: colors.accent,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.4,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 14,
  },
  previewCard: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  previewThumbWrap: {
    width: 120,
    aspectRatio: 16 / 9,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  previewThumb: {
    width: "100%",
    height: "100%",
  },
  previewThumbPlaceholder: {
    backgroundColor: colors.surfaceElevated,
  },
  previewBody: {
    flex: 1,
    justifyContent: "center",
  },
  previewTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  tagsSection: {
    gap: spacing.sm,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  tagSelected: {
    opacity: 1,
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
});
