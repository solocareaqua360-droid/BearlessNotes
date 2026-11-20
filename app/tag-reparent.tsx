import { Ionicons } from "@/components/icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SheetScreen } from "@/components/ui/SheetScreen";
import { TYPE, useSoft } from "@/theme/soft";
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
  const S = useSoft();
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

  const Row = ({ icon, label, checked, onPress, disabled, color }: { icon: string; label: string; checked?: boolean; onPress: () => void; disabled?: boolean; color?: string }) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? S.fill : "transparent" }]}
    >
      <View style={[styles.badge, { backgroundColor: color ?? S.fillSolid }]}>
        <Ionicons name={icon as any} size={15} color={color ? "#FFFFFF" : S.ink2} />
      </View>
      <Text style={[TYPE.row, { flex: 1, color: S.ink }]} numberOfLines={2}>
        {label}
      </Text>
      {checked ? <Ionicons name="checkmark" size={20} color={S.ink} /> : null}
    </Pressable>
  );

  return (
    <SheetScreen title="Батьківська смарт-папка">
      <Text style={[TYPE.meta, { color: S.ink2, paddingHorizontal: 4 }]}>
        {isBulk ? `Оберіть нову батьківську смарт-папку для ${targetIds.length} смарт-папок` : tag ? `Оберіть нову батьківську смарт-папку для «${tag.name}»` : ""}
      </Text>
      <View style={styles.list}>
        <Row
          icon="remove-circle-outline"
          label="Без батьківської смарт-папки (коренева)"
          checked={!isBulk && tag?.parentId == null}
          disabled={!isBulk && tag?.parentId == null}
          onPress={() => handleSelect(null)}
        />
        {options.map((item) => (
          <Row
            key={item.tag.id}
            icon={item.tag.icon}
            color={item.tag.color}
            label={item.path}
            checked={!isBulk && tag?.parentId === item.tag.id}
            onPress={() => handleSelect(item.tag.id)}
          />
        ))}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, borderRadius: 18, paddingHorizontal: 10 },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});
