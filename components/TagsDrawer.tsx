import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { SearchBar } from "@/components/SearchBar";
import { colors, radius, spacing } from "@/constants/theme";
import { Tag, Video } from "@/types";

interface TagRow {
  tag: Tag;
  depth: number;
  videoCount: number;
  hasChildren: boolean;
}

interface TagsDrawerProps {
  visible: boolean;
  onClose: () => void;
  tags: Tag[];
  videos: Video[];
  /** Filter mode: checkboxes + multi-select instead of navigation. */
  filterMode?: boolean;
  selectedTagIds?: string[];
  onChangeSelectedTagIds?: (ids: string[]) => void;
  onCreateTag?: () => void;
}

function buildRows(tags: Tag[], videos: Video[], expanded: Set<string>): TagRow[] {
  const byParent = new Map<string | null, Tag[]>();
  for (const tag of tags) {
    const list = byParent.get(tag.parentId) ?? [];
    list.push(tag);
    byParent.set(tag.parentId, list);
  }

  const countFor = (tagId: string): number =>
    videos.filter((v) => v.tagIds.includes(tagId)).length;

  const rows: TagRow[] = [];

  const walk = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    for (const tag of children) {
      const hasChildren = (byParent.get(tag.id) ?? []).length > 0;
      rows.push({ tag, depth, videoCount: countFor(tag.id), hasChildren });
      if (hasChildren && expanded.has(tag.id)) {
        walk(tag.id, depth + 1);
      }
    }
  };

  walk(null, 0);
  return rows;
}

export function TagsDrawer({
  visible,
  onClose,
  tags,
  videos,
  filterMode = false,
  selectedTagIds = [],
  onChangeSelectedTagIds,
  onCreateTag,
}: TagsDrawerProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filteredTags = useMemo(() => {
    if (!query.trim()) return tags;
    const q = query.trim().toLowerCase();
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, query]);

  const rows = useMemo(() => buildRows(filteredTags, videos, expanded), [filteredTags, videos, expanded]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelected = (id: string) => {
    if (!onChangeSelectedTagIds) return;
    const next = selectedTagIds.includes(id)
      ? selectedTagIds.filter((tagId) => tagId !== id)
      : [...selectedTagIds, id];
    onChangeSelectedTagIds(next);
  };

  const selectedTags = tags.filter((t) => selectedTagIds.includes(t.id));
  const unsortedCount = videos.filter((v) => v.tagIds.length === 0).length;
  const matchingVideoCount = videos.filter((v) => v.tagIds.some((id) => selectedTagIds.includes(id))).length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Теги</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <SearchBar value={query} onChangeText={setQuery} placeholder="Пошук тегів" />

          <View style={styles.specialRow}>
            <Ionicons name="mail-unread-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.specialLabel}>Inbox</Text>
          </View>
          <View style={styles.specialRow}>
            <Ionicons name="help-circle-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.specialLabel}>Невідсортоване</Text>
            <Text style={styles.specialCount}>{unsortedCount}</Text>
          </View>

          <FlatList
            data={rows}
            keyExtractor={(row) => row.tag.id}
            style={styles.list}
            contentContainerStyle={{ paddingBottom: spacing.lg }}
            renderItem={({ item }) => {
              const isSelected = selectedTagIds.includes(item.tag.id);
              return (
                <Pressable
                  style={[styles.row, { paddingLeft: spacing.sm + item.depth * spacing.lg }]}
                  onPress={() =>
                    filterMode ? toggleSelected(item.tag.id) : item.hasChildren && toggleExpand(item.tag.id)
                  }
                >
                  {filterMode ? (
                    <Ionicons
                      name={isSelected ? "checkbox" : "square-outline"}
                      size={18}
                      color={isSelected ? colors.accent : colors.textMuted}
                    />
                  ) : item.hasChildren ? (
                    <Ionicons
                      name={expanded.has(item.tag.id) ? "chevron-down" : "chevron-forward"}
                      size={16}
                      color={colors.textMuted}
                    />
                  ) : (
                    <View style={{ width: 16 }} />
                  )}

                  <Ionicons name={item.tag.icon as any} size={16} color={item.tag.color} />
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {item.tag.name}
                  </Text>
                  <Text style={styles.rowCount}>{item.videoCount}</Text>
                </Pressable>
              );
            }}
          />

          {filterMode && selectedTags.length > 0 && (
            <View style={styles.chipsRow}>
              {selectedTags.map((tag) => (
                <View key={tag.id} style={[styles.selectedChip, { backgroundColor: `${tag.color}26` }]}>
                  <Text style={[styles.selectedChipLabel, { color: tag.color }]}>{tag.name}</Text>
                </View>
              ))}
            </View>
          )}

          {filterMode ? (
            <Pressable style={styles.primaryButton} onPress={onClose}>
              <Text style={styles.primaryButtonLabel}>Показати {matchingVideoCount} відео</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.primaryButton} onPress={onCreateTag}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.primaryButtonLabel}>Новий тег</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: "row",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  panel: {
    width: "82%",
    maxWidth: 340,
    backgroundColor: colors.surface,
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
  },
  specialRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 6,
  },
  specialLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    flex: 1,
  },
  specialCount: {
    color: colors.textMuted,
    fontSize: 13,
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
  },
  rowLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    flex: 1,
  },
  rowCount: {
    color: colors.textMuted,
    fontSize: 12,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  selectedChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  selectedChipLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: 12,
    marginBottom: spacing.lg,
  },
  primaryButtonLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});
