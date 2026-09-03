import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@/constants/theme";
import { WatchStatus } from "@/types";

interface StatusToggleProps {
  value: WatchStatus;
  onChange: (value: WatchStatus) => void;
}

const OPTIONS: { key: WatchStatus; label: string }[] = [
  { key: "planned", label: "Планую подивитись" },
  { key: "watched", label: "Переглянуто" },
];

export function StatusToggle({ value, onChange }: StatusToggleProps) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onChange(option.key)}
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
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.pillInactive,
  },
  pillActive: {
    backgroundColor: colors.neutralActive,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  labelActive: {
    color: colors.textPrimary,
  },
});
