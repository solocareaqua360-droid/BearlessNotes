import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SearchBar } from "@/components/SearchBar";
import { colors, radius, spacing } from "@/constants/theme";
import { Tag, Video } from "@/types";

type PanelMode = "filter" | "edit";

interface TreeNode {
  tag: Tag;
  children: TreeNode[];
}

interface TagsDrawerProps {
  visible: boolean;
  onClose: () => void;
  tags: Tag[];
  videos: Video[];
  selectedTagIds: string[];
  onChangeSelectedTagIds: (ids: string[]) => void;
  onSelectUnsorted?: () => void;
  onCreateTag: () => void;
  onEditTag: (tagId: string) => void;
  onReparentTag: (tagId: string) => void;
  onDeleteTag: (tagId: string, mode: "delete_videos" | "unsort_videos") => void;
  /** Overrides the default "Показати N відео" label, e.g. for bulk-tagging. */
  confirmLabel?: string;
  /** Mode to reset to each time the drawer opens. Defaults to "filter". */
  initialMode?: PanelMode;
}

function buildTree(tags: Tag[]): TreeNode[] {
  const byParent = new Map<string | null, Tag[]>();
  for (const tag of tags) {
    const list = byParent.get(tag.parentId) ?? [];
    list.push(tag);
    byParent.set(tag.parentId, list);
  }
  const build = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? []).map((tag) => ({ tag, children: build(tag.id) }));
  return build(null);
}

export function TagsDrawer({
  visible,
  onClose,
  tags,
  videos,
  selectedTagIds,
  onChangeSelectedTagIds,
  onSelectUnsorted,
  onCreateTag,
  onEditTag,
  onReparentTag,
  onDeleteTag,
  confirmLabel,
  initialMode = "filter",
}: TagsDrawerProps) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<PanelMode>(initialMode);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menuTagId, setMenuTagId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setMode(initialMode);
      setMenuTagId(null);
    }
  }, [visible, initialMode]);

  const countFor = (tagId: string) => videos.filter((v) => v.tagIds.includes(tagId)).length;
  const unsortedCount = videos.filter((v) => v.tagIds.length === 0).length;

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  const tree = useMemo(() => buildTree(tags), [tags]);

  const searchMatches = useMemo(
    () => (isSearching ? tags.filter((t) => t.name.toLowerCase().includes(normalizedQuery)) : []),
    [tags, isSearching, normalizedQuery]
  );

  const toggleSelected = (id: string) => {
    const next = selectedTagIds.includes(id)
      ? selectedTagIds.filter((tagId) => tagId !== id)
      : [...selectedTagIds, id];
    onChangeSelectedTagIds(next);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openMenuFor = (tagId: string) => {
    setMode("edit");
    setMenuTagId(tagId);
  };

  const closeMenu = () => setMenuTagId(null);

  const handleDelete = (tag: Tag) => {
    closeMenu();
    Alert.alert(
      `Видалити тег "${tag.name}"?`,
      "Підтеги видаляться разом з ним. Що зробити з пов'язаними відео?",
      [
        { text: "Скасувати", style: "cancel" },
        { text: "Перенести в невідсортоване", onPress: () => onDeleteTag(tag.id, "unsort_videos") },
        { text: "Видалити відео", style: "destructive", onPress: () => onDeleteTag(tag.id, "delete_videos") },
      ]
    );
  };

  const renderRow = (tag: Tag, depth: number, hasChildren: boolean) => {
    const isSelected = selectedTagIds.includes(tag.id);
    const isExpanded = expanded.has(tag.id);
    const isMenuOpen = menuTagId === tag.id;

    return (
      <View key={tag.id}>
        <Pressable
          style={[styles.row, { paddingLeft: spacing.md + depth * spacing.xl }]}
          onPress={() => toggleSelected(tag.id)}
          onLongPress={() => openMenuFor(tag.id)}
        >
          {hasChildren ? (
            <Pressable onPress={() => toggleExpand(tag.id)} hitSlop={8}>
              <Ionicons
                name={isExpanded ? "chevron-down" : "chevron-forward"}
                size={14}
                color={colors.textMuted}
              />
            </Pressable>
          ) : depth > 0 ? null : (
            <View style={{ width: 14 }} />
          )}

          <View style={[styles.iconBadge, { backgroundColor: tag.color }]}>
            <Ionicons name={tag.icon as any} size={13} color="#fff" />
          </View>

          <Text style={styles.rowLabel} numberOfLines={1}>
            {tag.name}
          </Text>

          <Ionicons
            name={isSelected ? "checkbox" : "square-outline"}
            size={20}
            color={isSelected ? colors.iconDark : colors.border}
          />
          <Text style={styles.rowCount}>{countFor(tag.id)}</Text>
        </Pressable>

        {isMenuOpen && (
          <View style={styles.menu}>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                closeMenu();
                onEditTag(tag.id);
              }}
            >
              <Ionicons name="create-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.menuLabel}>Перейменувати</Text>
            </Pressable>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                closeMenu();
                onReparentTag(tag.id);
              }}
            >
              <Ionicons name="folder-outline" size={16} color={colors.textPrimary} />
              <Text style={[styles.menuLabel, { flex: 1 }]}>Материнська папка</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
            </Pressable>
            <Pressable style={styles.menuItem} onPress={() => handleDelete(tag)}>
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={[styles.menuLabel, { color: colors.danger }]}>Видалити</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  const renderNode = (node: TreeNode, depth: number): JSX.Element[] => {
    const hasChildren = node.children.length > 0;
    const rows = [renderRow(node.tag, depth, hasChildren)];
    if (hasChildren && expanded.has(node.tag.id)) {
      for (const child of node.children) {
        rows.push(...renderNode(child, depth + 1));
      }
    }
    return rows;
  };

  const selectedTags = tags.filter((t) => selectedTagIds.includes(t.id));
  const matchingVideoCount = videos.filter((v) => v.tagIds.some((id) => selectedTagIds.includes(id))).length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Теги</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.segmented}>
            <Pressable
              style={[styles.segment, mode === "filter" && styles.segmentActive]}
              onPress={() => {
                setMode("filter");
                closeMenu();
              }}
            >
              <Text style={[styles.segmentLabel, mode === "filter" && styles.segmentLabelActive]}>
                Фільтр
              </Text>
            </Pressable>
            <Pressable
              style={[styles.segment, mode === "edit" && styles.segmentActive]}
              onPress={() => setMode("edit")}
            >
              <Text style={[styles.segmentLabel, mode === "edit" && styles.segmentLabelActive]}>
                Редагування
              </Text>
            </Pressable>
          </View>

          <SearchBar value={query} onChangeText={setQuery} placeholder="Пошук тегів" />

          {!isSearching && (
            <Pressable
              style={styles.unsortedRow}
              onPress={onSelectUnsorted}
              disabled={!onSelectUnsorted}
            >
              <Ionicons name="help-circle-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.unsortedLabel}>Невідсортоване</Text>
              <Text style={styles.rowCount}>{unsortedCount}</Text>
            </Pressable>
          )}

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {isSearching
              ? searchMatches.map((tag) => (
                  <View key={tag.id} style={styles.card}>
                    {renderRow(tag, 0, false)}
                  </View>
                ))
              : tree.map((node) => (
                  <View key={node.tag.id} style={styles.card}>
                    {renderNode(node, 0)}
                  </View>
                ))}
          </ScrollView>

          {selectedTags.length > 0 && (
            <View style={styles.chipsRow}>
              {selectedTags.map((tag) => (
                <View key={tag.id} style={[styles.selectedChip, { backgroundColor: `${tag.color}26` }]}>
                  <Text style={[styles.selectedChipLabel, { color: tag.color }]}>{tag.name}</Text>
                </View>
              ))}
            </View>
          )}

          <Pressable style={styles.createRow} onPress={onCreateTag}>
            <Ionicons name="add" size={16} color={colors.iconDark} />
            <Text style={styles.createLabel}>Новий тег</Text>
          </Pressable>

          <Pressable style={styles.primaryButton} onPress={onClose}>
            <Text style={styles.primaryButtonLabel}>
              {confirmLabel ?? `Показати ${matchingVideoCount} відео`}
            </Text>
          </Pressable>
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
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  panel: {
    width: "84%",
    maxWidth: 340,
    backgroundColor: colors.background,
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
    fontSize: 20,
    fontWeight: "800",
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.pillInactive,
    borderRadius: radius.pill,
    padding: 4,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: radius.pill,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  segmentLabelActive: {
    color: colors.textPrimary,
  },
  unsortedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 4,
  },
  unsortedLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 11,
    paddingRight: spacing.md,
  },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    flex: 1,
  },
  rowCount: {
    color: colors.textMuted,
    fontSize: 12,
    minWidth: 14,
    textAlign: "right",
  },
  menu: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  menuLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
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
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 4,
  },
  createLabel: {
    color: colors.iconDark,
    fontSize: 14,
    fontWeight: "700",
  },
  primaryButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.neutralActive,
    borderRadius: radius.pill,
    paddingVertical: 14,
    marginBottom: spacing.lg,
  },
  primaryButtonLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
});
