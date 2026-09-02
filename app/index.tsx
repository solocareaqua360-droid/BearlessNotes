import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FilterPills, StatusFilter } from "@/components/FilterPills";
import { FilterTab } from "@/components/FilterTab";
import { FloatingIsland } from "@/components/FloatingIsland";
import { SearchBar } from "@/components/SearchBar";
import { TagsDrawer } from "@/components/TagsDrawer";
import { VideoCard } from "@/components/VideoCard";
import { colors, radius, spacing } from "@/constants/theme";
import { filterVideos, useLibraryStore } from "@/store/useLibraryStore";

type ViewLayout = "grid" | "list";

export default function HomeScreen() {
  const { unsorted } = useLocalSearchParams<{ unsorted?: string }>();

  const videos = useLibraryStore((s) => s.videos);
  const tags = useLibraryStore((s) => s.tags);
  const settings = useLibraryStore((s) => s.settings);
  const removeTag = useLibraryStore((s) => s.removeTag);
  const updateVideo = useLibraryStore((s) => s.updateVideo);

  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [tagsDrawerVisible, setTagsDrawerVisible] = useState(false);
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [unsortedOnly, setUnsortedOnly] = useState(unsorted === "1");
  const [layout, setLayout] = useState<ViewLayout>("grid");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [bulkTagDrawerVisible, setBulkTagDrawerVisible] = useState(false);
  const [bulkTagIds, setBulkTagIds] = useState<string[]>([]);

  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const filteredVideos = useMemo(
    () => filterVideos(videos, { status, tagIds: activeTagIds, query, unsortedOnly }),
    [videos, status, activeTagIds, query, unsortedOnly]
  );

  const activeTags = tags.filter((t) => activeTagIds.includes(t.id));

  const clearTagFilter = () => setActiveTagIds([]);
  const clearUnsortedFilter = () => setUnsortedOnly(false);

  const handleCardPress = (videoId: string, url: string) => {
    if (selectionMode) {
      toggleVideoSelected(videoId);
      return;
    }
    if (settings.openVideoMode === "external") {
      Linking.openURL(url);
    } else {
      router.push(`/video/${videoId}`);
    }
  };

  const handleCardLongPress = (videoId: string) => {
    setSelectionMode(true);
    setSelectedVideoIds([videoId]);
  };

  const toggleVideoSelected = (videoId: string) => {
    setSelectedVideoIds((prev) => {
      const next = prev.includes(videoId) ? prev.filter((id) => id !== videoId) : [...prev, videoId];
      if (next.length === 0) setSelectionMode(false);
      return next;
    });
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedVideoIds([]);
  };

  const applyBulkTags = () => {
    for (const videoId of selectedVideoIds) {
      const video = videos.find((v) => v.id === videoId);
      if (!video) continue;
      const merged = Array.from(new Set([...video.tagIds, ...bulkTagIds]));
      updateVideo(videoId, { tagIds: merged });
    }
    setBulkTagDrawerVisible(false);
    setBulkTagIds([]);
    cancelSelection();
  };

  const handleClearSearch = () => setQuery("");

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.headerTitle}>Мої відео</Text>
          <Pressable
            onPress={() => setLayout((prev) => (prev === "grid" ? "list" : "grid"))}
            style={styles.layoutButton}
            hitSlop={8}
          >
            <Ionicons
              name={layout === "grid" ? "list-outline" : "grid-outline"}
              size={18}
              color={colors.iconDark}
            />
          </Pressable>
        </View>

        {searchVisible && (
          <SearchBar value={query} onChangeText={setQuery} autoFocus onClear={handleClearSearch} />
        )}

        <FilterPills value={status} onChange={setStatus} />

        {unsortedOnly && (
          <View style={styles.activeFilterRow}>
            <View style={styles.activeFilterChip}>
              <Text style={styles.activeFilterLabel}>Невідсортоване</Text>
              <Pressable onPress={clearUnsortedFilter} hitSlop={8}>
                <Ionicons name="close" size={14} color={colors.textPrimary} />
              </Pressable>
            </View>
          </View>
        )}

        {activeTags.length > 0 && (
          <View style={styles.activeFilterRow}>
            <View style={styles.activeFilterChip}>
              <Text style={styles.activeFilterLabel} numberOfLines={1}>
                Фільтр: {activeTags.map((t) => t.name).join(", ")}
              </Text>
              <Pressable onPress={clearTagFilter} hitSlop={8}>
                <Ionicons name="close" size={14} color={colors.textPrimary} />
              </Pressable>
            </View>
          </View>
        )}
      </View>

      <FlatList
        key={layout}
        data={filteredVideos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <VideoCard
            video={item}
            tags={item.tagIds.map((id) => tagsById.get(id)).filter(Boolean) as any}
            layout={layout}
            selectable={selectionMode}
            selected={selectedVideoIds.includes(item.id)}
            onPress={() => handleCardPress(item.id, item.url)}
            onLongPress={() => handleCardLongPress(item.id)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Тут ще немає відео</Text>
            <Text style={styles.emptySubtitle}>
              Додайте перше посилання кнопкою "+" знизу.
            </Text>
          </View>
        }
      />

      {selectionMode ? (
        <View style={styles.selectionBar}>
          <Pressable onPress={cancelSelection}>
            <Text style={styles.selectionCancel}>Скасувати</Text>
          </Pressable>
          <Text style={styles.selectionCount}>Обрано: {selectedVideoIds.length}</Text>
          <Pressable style={styles.selectionAddTagButton} onPress={() => setBulkTagDrawerVisible(true)}>
            <Text style={styles.selectionAddTagLabel}>Додати тег</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <FloatingIsland
            onSearchPress={() => setSearchVisible((v) => !v)}
            onAddPress={() => router.push("/add-video")}
            onSettingsPress={() => router.push("/settings")}
          />
          <FilterTab onOpen={() => setTagsDrawerVisible(true)} />
        </>
      )}

      <TagsDrawer
        visible={tagsDrawerVisible}
        onClose={() => setTagsDrawerVisible(false)}
        tags={tags}
        videos={videos}
        selectedTagIds={activeTagIds}
        onChangeSelectedTagIds={(ids) => {
          setUnsortedOnly(false);
          setActiveTagIds(ids);
        }}
        onSelectUnsorted={() => {
          setUnsortedOnly(true);
          setActiveTagIds([]);
          setTagsDrawerVisible(false);
        }}
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
      />

      <TagsDrawer
        visible={bulkTagDrawerVisible}
        onClose={applyBulkTags}
        tags={tags}
        videos={videos}
        selectedTagIds={bulkTagIds}
        onChangeSelectedTagIds={setBulkTagIds}
        onCreateTag={() => router.push("/tag-editor")}
        onEditTag={(tagId) => router.push(`/tag-editor?tagId=${tagId}`)}
        onReparentTag={(tagId) => router.push(`/tag-reparent?tagId=${tagId}`)}
        onDeleteTag={(tagId, mode) => removeTag(tagId, mode)}
        confirmLabel={`Застосувати до ${selectedVideoIds.length} відео`}
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: "900",
  },
  layoutButton: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.pillInactive,
    alignItems: "center",
    justifyContent: "center",
  },
  activeFilterRow: {
    flexDirection: "row",
  },
  activeFilterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.pillInactive,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    maxWidth: "100%",
  },
  activeFilterLabel: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 140,
  },
  emptyState: {
    alignItems: "center",
    marginTop: spacing.xxl * 2,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  emptySubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: "center",
  },
  selectionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectionCancel: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  selectionCount: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
  },
  selectionAddTagButton: {
    backgroundColor: colors.neutralActive,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  selectionAddTagLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
  },
});
