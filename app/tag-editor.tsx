import { Ionicons } from "@/components/icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { tagIconOptions, tagPalette } from "@/constants/theme";
import { Field, SheetScreen } from "@/components/ui/SheetScreen";
import { FONT, RADIUS, softCursor, TYPE, useScheme, useSoft } from "@/theme/soft";
import { useLibraryStore } from "@/store/useLibraryStore";

export default function TagEditorScreen() {
  const S = useSoft();
  const scheme = useScheme();
  const { tagId, parentId } = useLocalSearchParams<{ tagId?: string; parentId?: string }>();
  const tags = useLibraryStore((s) => s.tags);
  const addTagPath = useLibraryStore((s) => s.addTagPath);
  const updateTag = useLibraryStore((s) => s.updateTag);

  const existing = useMemo(() => tags.find((t) => t.id === tagId), [tags, tagId]);

  const [name, setName] = useState(existing?.name ?? "");
  const [icon, setIcon] = useState(existing?.icon ?? tagIconOptions[0]);
  const [color, setColor] = useState(existing?.color ?? tagPalette[0]);

  const currentSegment = name.split("/").pop()?.trim().toLowerCase() ?? "";
  const suggestions = useMemo(() => {
    if (existing || !currentSegment) return [];
    return tags
      .filter(
        (t) => t.name.toLowerCase().includes(currentSegment) && t.name.toLowerCase() !== currentSegment
      )
      .slice(0, 5);
  }, [tags, currentSegment, existing]);

  const applySuggestion = (tagName: string) => {
    const segments = name.split("/");
    segments[segments.length - 1] = tagName;
    setName(segments.join("/") + "/");
  };

  const handleSave = () => {
    if (!name.trim()) return;
    if (existing) {
      updateTag(existing.id, { name: name.trim(), icon, color });
    } else {
      // A "new folder" made from inside a folder lands under it.
      const chain: string[] = [];
      let cursor = parentId ? tags.find((t) => t.id === parentId) : undefined;
      while (cursor) {
        chain.unshift(cursor.name);
        cursor = cursor.parentId ? tags.find((t) => t.id === cursor!.parentId) : undefined;
      }
      addTagPath([...chain, ...name.split("/")], icon, color);
    }
    router.back();
  };

  return (
    <SheetScreen
      title={existing ? "Редагувати смарт-папку" : "Нова смарт-папка"}
      doneLabel="Готово"
      onDone={handleSave}
      doneDisabled={!name.trim()}
    >
      <View style={styles.previewRow}>
        <View style={[styles.previewIcon, { backgroundColor: color }]}>
          <Ionicons name={icon as any} size={30} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Назва смарт-папки"
            placeholderTextColor={S.ink3}
            style={[styles.nameInput, { backgroundColor: S.fill, color: S.ink }]}
            {...softCursor(scheme)}
          />
          {!existing && suggestions.length === 0 && (
            <Text style={[TYPE.small, { color: S.ink3, paddingHorizontal: 6 }]}>
              Для вкладеної смарт-папки використайте «/», напр. «Розробка/React Native»
            </Text>
          )}
        </View>
      </View>

      {suggestions.length > 0 && (
        <View style={[styles.suggestions, { backgroundColor: S.fill }]}>
          {suggestions.map((tag) => (
            <Pressable key={tag.id} style={styles.suggestionRow} onPress={() => applySuggestion(tag.name)}>
              <View style={[styles.suggestionIcon, { backgroundColor: tag.color }]}>
                <Ionicons name={tag.icon as any} size={13} color="#FFFFFF" />
              </View>
              <Text style={[TYPE.row, { color: S.ink }]}>{tag.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Field label="Іконка">
        <View style={styles.iconGrid}>
          {tagIconOptions.map((option) => {
            const selected = option === icon;
            return (
              <View key={option} style={styles.iconCellWrap}>
                <Pressable
                  style={[styles.iconCell, { backgroundColor: selected ? `${color}26` : S.fill }]}
                  onPress={() => setIcon(option)}
                >
                  <Ionicons name={option as any} size={21} color={selected ? color : S.ink2} />
                </Pressable>
              </View>
            );
          })}
        </View>
      </Field>

      <Field label="Колір">
        <View style={styles.colorRow}>
          {tagPalette.map((option) => {
            const selected = option === color;
            return (
              <Pressable
                key={option}
                onPress={() => setColor(option)}
                style={[styles.colorRing, selected && { borderColor: S.ink }]}
              >
                <View style={[styles.colorDot, { backgroundColor: option }]} />
              </Pressable>
            );
          })}
        </View>
      </Field>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  previewRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  previewIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  nameInput: { height: 52, borderRadius: 26, paddingHorizontal: 20, fontFamily: FONT.regular, fontWeight: "normal", fontSize: 16 },
  suggestions: { borderRadius: 20, padding: 6 },
  suggestionRow: { flexDirection: "row", alignItems: "center", gap: 12, height: 46, paddingHorizontal: 10 },
  suggestionIcon: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  iconGrid: { flexDirection: "row", flexWrap: "wrap" },
  iconCellWrap: { width: "16.66%", padding: 4, aspectRatio: 1 },
  iconCell: { flex: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 2 },
  colorRing: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  colorDot: { width: 30, height: 30, borderRadius: 15 },
});
