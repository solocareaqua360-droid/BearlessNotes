import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radius, spacing, tagIconOptions, tagPalette } from "@/constants/theme";
import { useLibraryStore } from "@/store/useLibraryStore";

export default function TagEditorScreen() {
  const { tagId } = useLocalSearchParams<{ tagId?: string }>();
  const tags = useLibraryStore((s) => s.tags);
  const addTagPath = useLibraryStore((s) => s.addTagPath);
  const updateTag = useLibraryStore((s) => s.updateTag);

  const existing = useMemo(() => tags.find((t) => t.id === tagId), [tags, tagId]);

  const [name, setName] = useState(existing?.name ?? "");
  const [icon, setIcon] = useState(existing?.icon ?? tagIconOptions[0]);
  const [color, setColor] = useState(existing?.color ?? tagPalette[0]);

  const handleSave = () => {
    if (!name.trim()) return;
    if (existing) {
      updateTag(existing.id, { name: name.trim(), icon, color });
    } else {
      addTagPath(name.split("/"), icon, color);
    }
    router.back();
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.headerAction}>Скасувати</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{existing ? "Редагувати тег" : "Новий тег"}</Text>
        <Pressable onPress={handleSave} disabled={!name.trim()}>
          <Text style={[styles.headerAction, styles.headerDone, !name.trim() && styles.disabled]}>
            Готово
          </Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={styles.previewRow}>
          <View style={[styles.previewIcon, { backgroundColor: color }]}>
            <Ionicons name={icon as any} size={28} color="#fff" />
          </View>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Назва тега"
              placeholderTextColor={colors.textMuted}
              style={styles.nameInput}
            />
            {!existing && (
              <Text style={styles.hint}>
                Для вкладеного тега використайте "/", напр. "Розробка/React Native"
              </Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Іконка</Text>
          <View style={styles.iconGrid}>
            {tagIconOptions.map((option) => {
              const selected = option === icon;
              return (
                <Pressable
                  key={option}
                  style={[styles.iconCell, selected && styles.iconCellSelected]}
                  onPress={() => setIcon(option)}
                >
                  <Ionicons
                    name={option as any}
                    size={20}
                    color={selected ? color : colors.textSecondary}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Колір</Text>
          <View style={styles.colorRow}>
            {tagPalette.map((option) => {
              const selected = option === color;
              return (
                <Pressable
                  key={option}
                  style={[
                    styles.colorDot,
                    { backgroundColor: option },
                    selected && styles.colorDotSelected,
                  ]}
                  onPress={() => setColor(option)}
                />
              );
            })}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const ICON_CELL_SIZE = "16.66%";

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
  headerDone: {
    color: colors.accent,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.4,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  previewIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  nameInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 15,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 11,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  iconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  iconCell: {
    width: ICON_CELL_SIZE as any,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconCellSelected: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
  },
  colorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  colorDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  colorDotSelected: {
    borderWidth: 3,
    borderColor: colors.textPrimary,
  },
});
