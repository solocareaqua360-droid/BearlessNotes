import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/constants/theme";
import { useLibraryStore } from "@/store/useLibraryStore";
import { Tag, Video } from "@/types";

interface TagRow {
  tag: Tag;
  depth: number;
  videoCount: number;
}

function flattenTags(tags: Tag[], videos: Video[]): TagRow[] {
  const byParent = new Map<string | null, Tag[]>();
  for (const tag of tags) {
    const list = byParent.get(tag.parentId) ?? [];
    list.push(tag);
    byParent.set(tag.parentId, list);
  }

  const countFor = (tagId: string) => videos.filter((v) => v.tagIds.includes(tagId)).length;

  const rows: TagRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const tag of byParent.get(parentId) ?? []) {
      rows.push({ tag, depth, videoCount: countFor(tag.id) });
      walk(tag.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export default function ManageTagsScreen() {
  const tags = useLibraryStore((s) => s.tags);
  const videos = useLibraryStore((s) => s.videos);
  const removeTag = useLibraryStore((s) => s.removeTag);

  const rows = useMemo(() => flattenTags(tags, videos), [tags, videos]);

  const handleDelete = (row: TagRow) => {
    Alert.alert(
      `Видалити тег "${row.tag.name}"?`,
      "Підтеги видаляться разом з ним. Що зробити з пов'язаними відео?",
      [
        { text: "Скасувати", style: "cancel" },
        {
          text: "Перенести в невідсортоване",
          onPress: () => removeTag(row.tag.id, "unsort_videos"),
        },
        {
          text: "Видалити відео",
          style: "destructive",
          onPress: () => removeTag(row.tag.id, "delete_videos"),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Редагувати теги</Text>
        <Pressable onPress={() => router.push("/tag-editor")} hitSlop={8}>
          <Ionicons name="add" size={24} color={colors.accent} />
        </Pressable>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row) => row.tag.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, { paddingLeft: spacing.lg + item.depth * spacing.lg }]}
            onPress={() => router.push(`/tag-editor?tagId=${item.tag.id}`)}
          >
            <View style={[styles.iconBadge, { backgroundColor: item.tag.color }]}>
              <Ionicons name={item.tag.icon as any} size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {item.tag.name}
            </Text>
            <Text style={styles.rowCount}>{item.videoCount}</Text>
            <Pressable onPress={() => handleDelete(item)} hitSlop={8} style={styles.deleteButton}>
              <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
            </Pressable>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Тегів ще немає</Text>
            <Text style={styles.emptySubtitle}>Додайте перший кнопкою "+" вгорі.</Text>
          </View>
        }
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
  listContent: {
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingRight: spacing.lg,
    paddingVertical: 12,
  },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
  },
  rowCount: {
    color: colors.textMuted,
    fontSize: 12,
  },
  deleteButton: {
    padding: 4,
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
  },
});
