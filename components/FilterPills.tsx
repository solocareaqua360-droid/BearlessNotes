import { StyleSheet, View } from "react-native";

import { Pill } from "@/components/ui/Pill";
import { WatchStatus } from "@/types";

export type StatusFilter = WatchStatus | "all";

const OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Усі" },
  { key: "planned", label: "Планую" },
  { key: "watched", label: "Переглянуто" },
];

export function FilterPills({ value, onChange }: { value: StatusFilter; onChange: (value: StatusFilter) => void }) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((o) => (
        <Pill key={o.key} label={o.label} selected={o.key === value} onPress={() => onChange(o.key)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", gap: 8 } });
