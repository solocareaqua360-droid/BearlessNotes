import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StatusToggle } from "@/components/StatusToggle";
import { TagsDrawer } from "@/components/TagsDrawer";
import { colors, radius, spacing } from "@/constants/theme";
import { fetchVideoMeta, VideoMeta } from "@/services/videoMeta";
import { useLibraryStore } from "@/store/useLibraryStore";
import { WatchStatus } from "@/types";

const META_FETCH_DEBOUNCE_MS = 500;

export default function AddVideoScreen() {
  const { sharedUrl } = useLocalSearchParams<{ sharedUrl?: string }>();
  const tags = useLibraryStore((s) => s.tags);
  const videos = useLibraryStore((s) => s.videos);
  const addVideo = useLibraryStore((s) => s.addVideo);
  const removeTag = useLibraryStore((s) => s.removeTag);

  const [url, setUrl] = useState(sharedUrl ?? "");
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [status, setStatus] = useState<WatchStatus>("planned");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [tagsDrawerVisible, setTagsDrawerVisible] = useState(false);

  const latestRequestUrl = useRef<string | null>(null);

  useEffect(() => {
    if (sharedUrl) setUrl(sharedUrl);
  }, [sharedUrl]);

  useEffect(() => {
    const trimmed = url.trim();
    if (trimmed.length < 8) {
      setMeta(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      latestRequestUrl.current = trimmed;
      const result = await fetchVideoMeta(trimmed);
      // Ignore a response for a link the user has since changed away from.
      if (latestRequestUrl.current === trimmed) {
        setMeta(result);
        setLoading(false);
      }
    }, META_FETCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [url]);

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
          onChangeText={setUrl}
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
          <Text style={styles.tagsSectionLabel}>Теги</Text>
          <Pressable style={styles.tagSelector} onPress={() => setTagsDrawerVisible(true)}>
            <Text style={styles.tagSelectorText} numberOfLines={1}>
              {selectedTagIds.length > 0
                ? tags
                    .filter((t) => selectedTagIds.includes(t.id))
                    .map((t) => t.name)
                    .join(", ")
                : "Обрати теги"}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      <TagsDrawer
        visible={tagsDrawerVisible}
        onClose={() => setTagsDrawerVisible(false)}
        tags={tags}
        videos={videos}
        selectedTagIds={selectedTagIds}
        onChangeSelectedTagIds={setSelectedTagIds}
        onCreateTag={() => {
          setTagsDrawerVisible(false);
          router.push("/tag-editor");
        }}
        onEditTag={(tagId) => {
          setTagsDrawerVisible(false);
          router.push(`/tag-editor?tagId=${tagId}`);
        }}
        onReparentTag={(tagId) => {
          setTagsDrawerVisible(false);
          router.push(`/tag-reparent?tagId=${tagId}`);
        }}
        onDeleteTag={(tagId, mode) => removeTag(tagId, mode)}
        onBulkReparentTags={(tagIds) => {
          setTagsDrawerVisible(false);
          router.push(`/tag-reparent?tagIds=${tagIds.join(",")}`);
        }}
        confirmLabel="Готово"
      />
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
    color: colors.iconDark,
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
  tagsSectionLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  tagSelector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  tagSelectorText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
  },
});
