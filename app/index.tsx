import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FilterPills, StatusFilter } from "@/components/FilterPills";
import { FloatingIsland } from "@/components/FloatingIsland";
import { SearchBar } from "@/components/SearchBar";
import { TagsDrawer } from "@/components/TagsDrawer";
import { VideoCard } from "@/components/VideoCard";
import { colors, radius, spacing } from "@/constants/theme";
import { filterVideos, useLibraryStore } from "@/store/useLibraryStore";

export default function HomeScreen() {
  const { unsorted } = useLocalSearchParams<{ unsorted?: string }>();

  const videos = useLibraryStore((s) => s.videos);
  const tags = useLibraryStore((s) => s.tags);

  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [tagsDrawerVisible, setTagsDrawerVisible] = useState(false);
  const [filterDrawerVisible, setFilterDrawerVisible] = useState(false);
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [unsortedOnly, setUnsortedOnly] = useState(unsorted === "1");

  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const filteredVideos = useMemo(
    () => filterVideos(videos, { status, tagIds: activeTagIds, query, unsortedOnly }),
    [videos, status, activeTagIds, query, unsortedOnly]
  );

  const resetToAll = () => {
    setUnsortedOnly(false);
    setActiveTagIds([]);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.headerTitle}>Мої відео</Text>
          <Pressable onPress={() => router.push("/settings")} hitSlop={8}>
            <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        {searchVisible && <SearchBar value={query} onChangeText={setQuery} />}

        <FilterPills value={status} onChange={setStatus} />

        {unsortedOnly && (
          <View style={styles.activeFilterRow}>
            <View style={styles.activeFilterChip}>
              <Text style={styles.activeFilterLabel}>Невідсортоване</Text>
              <Pressable onPress={resetToAll} hitSlop={8}>
                <Ionicons name="close" size={14} color={colors.textPrimary} />
              </Pressable>
            </View>
          </View>
        )}
      </View>

      <FlatList
        data={filteredVideos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <VideoCard
            video={item}
            tags={item.tagIds.map((id) => tagsById.get(id)).filter(Boolean) as any}
            onPress={() => router.push(`/video/${item.id}`)}
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

      <FloatingIsland
        onTagsPress={() => setTagsDrawerVisible(true)}
        onSearchPress={() => setSearchVisible((v) => !v)}
        onAddPress={() => router.push("/add-video")}
        onFiltersPress={() => setFilterDrawerVisible(true)}
      />

      <TagsDrawer
        visible={tagsDrawerVisible}
        onClose={() => setTagsDrawerVisible(false)}
        tags={tags}
        videos={videos}
        onCreateTag={() => {
          setTagsDrawerVisible(false);
          router.push("/tag-editor");
        }}
        onSelectInbox={() => {
          resetToAll();
          setTagsDrawerVisible(false);
        }}
        onSelectUnsorted={() => {
          setUnsortedOnly(true);
          setActiveTagIds([]);
          setTagsDrawerVisible(false);
        }}
      />

      <TagsDrawer
        visible={filterDrawerVisible}
        onClose={() => setFilterDrawerVisible(false)}
        tags={tags}
        videos={videos}
        filterMode
        selectedTagIds={activeTagIds}
        onChangeSelectedTagIds={(ids) => {
          setUnsortedOnly(false);
          setActiveTagIds(ids);
        }}
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
    fontSize: 26,
    fontWeight: "800",
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
  },
  activeFilterLabel: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "600",
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
});
