import { Pressable, StyleSheet, Text, View } from "react-native";

import { Ionicons } from "@/components/icons/Ionicons";
import { FONT } from "@/theme/soft";
import { Tag } from "@/types";

interface TagChipProps {
  tag: Tag;
  compact?: boolean;
  onRemove?: () => void;
}

// The tag's own colour is CONTENT, so it is the one place a bright colour
// is allowed; the chip is a faint wash of it with the tag's name in it.
export function TagChip({ tag, compact, onRemove }: TagChipProps) {
  return (
    <View style={[styles.chip, { backgroundColor: `${tag.color}24` }, compact && styles.chipCompact]}>
      <Ionicons name={tag.icon as any} size={compact ? 11 : 13} color={tag.color} />
      <Text style={[styles.label, { color: tag.color }, compact && styles.labelCompact]} numberOfLines={1}>
        {tag.name}
      </Text>
      {onRemove && (
        <Pressable style={styles.remove} onPress={onRemove} hitSlop={8}>
          <Ionicons name="close" size={10} color={tag.color} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, height: 30, borderRadius: 15 },
  chipCompact: { paddingHorizontal: 9, height: 24, borderRadius: 12 },
  label: { fontFamily: FONT.medium, fontWeight: "normal", fontSize: 13, flexShrink: 1 },
  labelCompact: { fontSize: 11.5 },
  remove: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", marginRight: -3 },
});
