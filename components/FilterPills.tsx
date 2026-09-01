import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@/constants/theme";
import { WatchStatus } from "@/types";

export type StatusFilter = WatchStatus | "all";

const OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Усі" },
  { key: "planned", label: "Планую подивитись" },
  { key: "watched", label: "Переглянуто" },
];

interface FilterPillsProps {
  value: StatusFilter;
  onChange: (value: StatusFilter) => void;
}

export function FilterPills({ value, onChange }: FilterPillsProps) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={[styles.pill, active && styles.pillActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.pillInactive,
  },
  pillActive: {
    backgroundColor: colors.accent,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  labelActive: {
    color: "#fff",
  },
});
