import { JSX, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@/components/icons/Ionicons";
import { SearchBar } from "@/components/SearchBar";
import { SoftCheck } from "@/components/SoftIcon";
import { ask } from "@/components/ui/Ask";
import { GlassBlur, GlassPortal } from "@/components/ui/Glass";
import { Pill } from "@/components/ui/Pill";
import { FONT, RADIUS, TYPE, useSoft } from "@/theme/soft";
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
  /** Whether "Невідсортоване" is the currently active filter. */
  unsortedSelected?: boolean;
  onCreateTag: () => void;
  onEditTag: (tagId: string) => void;
  onReparentTag: (tagId: string) => void;
  onDeleteTag: (tagId: string, mode: "delete_videos" | "unsort_videos") => void;
  /** In "Редагування" mode, several ticked tags offer a bulk move. */
  onBulkReparentTags?: (tagIds: string[]) => void;
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

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

export function TagsDrawer({
  visible,
  onClose,
  tags,
  videos,
  selectedTagIds,
  onChangeSelectedTagIds,
  onSelectUnsorted,
  unsortedSelected,
  onCreateTag,
  onEditTag,
  onReparentTag,
  onDeleteTag,
  onBulkReparentTags,
  confirmLabel,
  initialMode = "filter",
}: TagsDrawerProps) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<PanelMode>(initialMode);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menuTagId, setMenuTagId] = useState<string | null>(null);
  const [bulkEditTagIds, setBulkEditTagIds] = useState<Set<string>>(new Set());

  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      setMode(initialMode);
      setMenuTagId(null);
      setBulkEditTagIds(new Set());
      setMounted(true);
      Animated.timing(progress, { toValue: 1, duration: 300, easing: EASE, useNativeDriver: true }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) setMounted(false);
        }
      );
    }
  }, [visible, initialMode, progress]);

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
    const next = selectedTagIds.includes(id) ? selectedTagIds.filter((t) => t !== id) : [...selectedTagIds, id];
    onChangeSelectedTagIds(next);
  };
  const toggleBulk = (id: string) =>
    setBulkEditTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openMenuFor = (tagId: string) => {
    setMode("edit");
    setMenuTagId(tagId);
  };
  const closeMenu = () => setMenuTagId(null);

  const askDelete = async (title: string) => {
    const key = await ask({
      title,
      message: "Вкладені смарт-папки теж буде видалено. Що зробити з пов'язаними відео?",
      answers: [
        { key: "unsort", label: "Перенести в невідсортоване", primary: true },
        { key: "delete", label: "Видалити відео", destructive: true },
      ],
    });
    return key === "unsort" ? "unsort_videos" : key === "delete" ? "delete_videos" : null;
  };

  const handleDelete = async (tag: Tag) => {
    closeMenu();
    const mode2 = await askDelete(`Видалити смарт-папку «${tag.name}»?`);
    if (mode2) onDeleteTag(tag.id, mode2);
  };

  const handleBulkMove = () => {
    const ids = Array.from(bulkEditTagIds);
    setBulkEditTagIds(new Set());
    onBulkReparentTags?.(ids);
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(bulkEditTagIds);
    const mode2 = await askDelete(`Видалити смарт-папок: ${ids.length}?`);
    if (!mode2) return;
    ids.forEach((id) => onDeleteTag(id, mode2));
    setBulkEditTagIds(new Set());
  };

  const renderRow = (tag: Tag, depth: number, hasChildren: boolean) => {
    const isChecked = mode === "edit" ? bulkEditTagIds.has(tag.id) : selectedTagIds.includes(tag.id);
    const isExpanded = expanded.has(tag.id);
    const isMenuOpen = menuTagId === tag.id;

    return (
      <View key={tag.id}>
        <Pressable
          style={({ pressed }) => [styles.row, { paddingLeft: 14 + depth * 22, backgroundColor: pressed ? S.fill : "transparent" }]}
          onPress={() => (mode === "edit" ? toggleBulk(tag.id) : toggleSelected(tag.id))}
          onLongPress={() => openMenuFor(tag.id)}
        >
          <View style={styles.chevronSlot}>
            {hasChildren ? (
              <Pressable onPress={() => toggleExpand(tag.id)} hitSlop={10}>
                <Ionicons name={isExpanded ? "chevron-down" : "chevron-forward"} size={16} color={S.ink3} />
              </Pressable>
            ) : null}
          </View>
          <View style={[styles.badge, { backgroundColor: tag.color }]}>
            <Ionicons name={tag.icon as any} size={15} color="#FFFFFF" />
          </View>
          <Text style={[TYPE.row, { flex: 1, color: S.ink }]} numberOfLines={1}>
            {tag.name}
          </Text>
          <SoftCheck checked={isChecked} size={22} accent={S.accent} outline={S.ink3} tickColor={S.chrome} />
          <Text style={[styles.count, { color: S.ink3 }]}>{countFor(tag.id)}</Text>
        </Pressable>

        {isMenuOpen && (
          <View style={[styles.menu, { backgroundColor: S.fill }]}>
            <MenuRow icon="create-outline" label="Перейменувати" onPress={() => { closeMenu(); onEditTag(tag.id); }} />
            <MenuRow icon="folder-outline" label="Батьківська смарт-папка" chevron onPress={() => { closeMenu(); onReparentTag(tag.id); }} />
            <MenuRow icon="trash-outline" label="Видалити" destructive onPress={() => handleDelete(tag)} />
            <MenuRow icon="close-outline" label="Скасувати" muted onPress={closeMenu} />
          </View>
        )}
      </View>
    );
  };

  const MenuRow = ({ icon, label, onPress, destructive, muted, chevron }: { icon: string; label: string; onPress: () => void; destructive?: boolean; muted?: boolean; chevron?: boolean }) => (
    <Pressable style={styles.menuRow} onPress={onPress}>
      <Ionicons name={icon as any} size={18} color={destructive ? S.danger : muted ? S.ink3 : S.ink2} />
      <Text style={[TYPE.row, { flex: 1, fontSize: 15, color: destructive ? S.danger : muted ? S.ink3 : S.ink }]}>{label}</Text>
      {chevron ? <Ionicons name="chevron-forward" size={15} color={S.ink3} /> : null}
    </Pressable>
  );

  const renderNode = (node: TreeNode, depth: number): JSX.Element[] => {
    const hasChildren = node.children.length > 0;
    const rows = [renderRow(node.tag, depth, hasChildren)];
    if (hasChildren && expanded.has(node.tag.id)) {
      for (const child of node.children) rows.push(...renderNode(child, depth + 1));
    }
    return rows;
  };

  const selectedTags = tags.filter((t) => selectedTagIds.includes(t.id));
  const matchingVideoCount = videos.filter((v) => v.tagIds.some((id) => selectedTagIds.includes(id))).length;
  const bulkEditCount = bulkEditTagIds.size;
  const showBulkEditBar = mode === "edit" && bulkEditCount > 0;

  if (!mounted) return null;
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-380, 0] });

  return (
    <GlassPortal>
    <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
        <GlassBlur intensity={45} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(17,24,39,0.40)" }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          {
            backgroundColor: S.bg,
            boxShadow: S.popShadow,
            paddingTop: insets.top + 14,
            paddingBottom: insets.bottom + 14,
            transform: [{ translateX }],
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={[TYPE.title, { color: S.ink }]}>Смарт-папки</Text>
          <Pressable onPress={onClose} hitSlop={10} style={[styles.closeBtn, { backgroundColor: S.fill }]}>
            <Ionicons name="close" size={18} color={S.ink2} />
          </Pressable>
        </View>

        <View style={styles.segmented}>
          <Pill flex label="Фільтр" selected={mode === "filter"} onPress={() => { setMode("filter"); closeMenu(); setBulkEditTagIds(new Set()); }} />
          <Pill flex label="Редагування" selected={mode === "edit"} onPress={() => setMode("edit")} />
        </View>

        <SearchBar value={query} onChangeText={setQuery} placeholder="Пошук смарт-папок" />

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {!isSearching && (
            <View style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow }]}>
              <Pressable
                style={({ pressed }) => [styles.row, { paddingLeft: 14, backgroundColor: pressed ? S.fill : "transparent" }]}
                onPress={onSelectUnsorted}
                disabled={!onSelectUnsorted}
              >
                <View style={styles.chevronSlot} />
                <View style={[styles.badge, { backgroundColor: S.fillSolid }]}>
                  <Ionicons name="arrow-down" size={15} color={S.ink2} />
                </View>
                <Text style={[TYPE.row, { flex: 1, color: S.ink }]} numberOfLines={1}>
                  Невідсортоване
                </Text>
                <SoftCheck checked={!!unsortedSelected} size={22} accent={S.accent} outline={S.ink3} tickColor={S.chrome} />
                <Text style={[styles.count, { color: S.ink3 }]}>{unsortedCount}</Text>
              </Pressable>
            </View>
          )}

          {isSearching
            ? searchMatches.map((tag) => (
                <View key={tag.id} style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow }]}>
                  {renderRow(tag, 0, false)}
                </View>
              ))
            : tree.map((node) => (
                <View key={node.tag.id} style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow }]}>
                  {renderNode(node, 0)}
                </View>
              ))}
        </ScrollView>

        {selectedTags.length > 0 && mode === "filter" && (
          <View style={styles.chipsRow}>
            {selectedTags.map((tag) => (
              <View key={tag.id} style={[styles.selChip, { backgroundColor: `${tag.color}24` }]}>
                <Text style={[styles.selChipLabel, { color: tag.color }]}>{tag.name}</Text>
              </View>
            ))}
          </View>
        )}

        {!showBulkEditBar && (
          <Pressable style={styles.createRow} onPress={onCreateTag}>
            <Ionicons name="add" size={18} color={S.ink2} />
            <Text style={[TYPE.row, { fontSize: 15, color: S.ink2 }]}>Нова смарт-папка</Text>
          </Pressable>
        )}

        {showBulkEditBar ? (
          <View style={styles.bulkRow}>
            <Pressable style={[styles.bigBtn, styles.half, { backgroundColor: S.ink }]} onPress={handleBulkMove}>
              <Ionicons name="folder-outline" size={19} color={S.chrome} />
              <Text style={[TYPE.row, { color: S.chrome }]}>Перенести ({bulkEditCount})</Text>
            </Pressable>
            <Pressable style={[styles.bigBtn, styles.half, { backgroundColor: S.fill }]} onPress={handleBulkDelete}>
              <Ionicons name="trash-outline" size={19} color={S.danger} />
              <Text style={[TYPE.row, { color: S.danger }]}>Видалити ({bulkEditCount})</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={[styles.bigBtn, { backgroundColor: S.ink }]} onPress={onClose}>
            <Text style={[TYPE.row, { color: S.chrome }]}>{confirmLabel ?? `Показати ${matchingVideoCount} відео`}</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 500 },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: "88%",
    maxWidth: 380,
    borderTopRightRadius: RADIUS.sheet,
    borderBottomRightRadius: RADIUS.sheet,
    paddingHorizontal: 16,
    gap: 12,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  segmented: { flexDirection: "row", gap: 8 },
  listContent: { gap: 10, paddingBottom: 8 },
  card: { borderRadius: RADIUS.card, overflow: "hidden", paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingRight: 14 },
  chevronSlot: { width: 18, alignItems: "center" },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  count: { fontFamily: FONT.medium, fontWeight: "normal", fontSize: 12.5, minWidth: 16, textAlign: "right" },
  menu: { marginHorizontal: 12, marginBottom: 8, borderRadius: 18, overflow: "hidden" },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 12, height: 46, paddingHorizontal: 14 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  selChip: { paddingHorizontal: 10, height: 26, borderRadius: 13, justifyContent: "center" },
  selChipLabel: { fontFamily: FONT.medium, fontWeight: "normal", fontSize: 12.5 },
  createRow: { flexDirection: "row", alignItems: "center", gap: 8, height: 36, paddingHorizontal: 6 },
  bulkRow: { flexDirection: "row", gap: 8 },
  half: { flex: 1 },
  bigBtn: { height: 52, borderRadius: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
});
