import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/constants/theme";
import { useLibraryStore } from "@/store/useLibraryStore";
import { Tag } from "@/types";

function fullPath(tag: Tag, byId: Map<string, Tag>): string {
  const segments: string[] = [tag.name];
  let current = tag;
  while (current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    segments.unshift(parent.name);
    current = parent;
  }
  return segments.join(" / ");
}

export default function TagReparentScreen() {
  const { tagId, tagIds: tagIdsParam } = useLocalSearchParams<{ tagId?: string; tagIds?: string }>();
  const tags = useLibraryStore((s) => s.tags);
  const updateTag = useLibraryStore((s) => s.updateTag);

  const targetIds = useMemo(
    () => (tagIdsParam ? tagIdsParam.split(",").filter(Boolean) : tagId ? [tagId] : []),
    [tagIdsParam, tagId]
  );
  const isBulk = targetIds.length > 1;

  const byId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const tag = !isBulk ? byId.get(targetIds[0] ?? "") : undefined;

  const excludedIds = useMemo(() => {
    const ids = new Set<string>(targetIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of tags) {
        if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) {
          ids.add(t.id);
          changed = true;
        }
      }
    }
    return ids;
  }, [tags, targetIds]);

  const options = tags
    .filter((t) => !excludedIds.has(t.id))
    .map((t) => ({ tag: t, path: fullPath(t, byId) }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const handleSelect = (newParentId: string | null) => {
    if (targetIds.length === 0) return;
    targetIds.forEach((id) => updateTag(id, { parentId: newParentId }));
    router.back();
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Материнська папка</Text>
        <View style={{ width: 22 }} />
      </View>

      {isBulk ? (
        <Text style={styles.subtitle}>Оберіть новий батьківський тег для {targetIds.length} тегів</Text>
      ) : (
        tag && <Text style={styles.subtitle}>Оберіть новий батьківський тег для "{tag.name}"</Text>
      )}

      <FlatList
        data={options}
        keyExtractor={(item) => item.tag.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <Pressable
            style={styles.row}
            onPress={() => handleSelect(null)}
            disabled={!isBulk && tag?.parentId == null}
          >
            <Ionicons name="remove-circle-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.rowLabel}>Без батьківського тега (кореневий)</Text>
            {tag?.parentId == null && (
              <Ionicons name="checkmark" size={18} color={colors.iconDark} />
            )}
          </Pressable>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => handleSelect(item.tag.id)}>
            <View style={[styles.iconBadge, { backgroundColor: item.tag.color }]}>
              <Ionicons name={item.tag.icon as any} size={13} color="#fff" />
            </View>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {item.path}
            </Text>
            {tag?.parentId === item.tag.id && (
              <Ionicons name="checkmark" size={18} color={colors.iconDark} />
            )}
          </Pressable>
        )}
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
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  iconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
  },
});
