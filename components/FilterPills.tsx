import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@/constants/theme";
import { WatchStatus } from "@/types";

export type StatusFilter = WatchStatus | "all";

const OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Усі" },
  { key: "planned", label: "Планую" },
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
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.pillInactive,
  },
  pillActive: {
    backgroundColor: colors.neutralActive,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "700",
  },
  labelActive: {
    color: colors.textPrimary,
  },
});
