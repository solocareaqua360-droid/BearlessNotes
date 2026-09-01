import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { radius, spacing } from "@/constants/theme";
import { Tag } from "@/types";

interface TagChipProps {
  tag: Tag;
  compact?: boolean;
}

export function TagChip({ tag, compact }: TagChipProps) {
  return (
    <View style={[styles.chip, { backgroundColor: `${tag.color}26` }, compact && styles.chipCompact]}>
      <Ionicons name={tag.icon as any} size={compact ? 11 : 13} color={tag.color} />
      <Text style={[styles.label, { color: tag.color }, compact && styles.labelCompact]} numberOfLines={1}>
        {tag.name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  chipCompact: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
  labelCompact: {
    fontSize: 11,
  },
});
