import { StyleSheet, View } from "react-native";

import { Pill } from "@/components/ui/Pill";
import { WatchStatus } from "@/types";

const OPTIONS: { key: WatchStatus; label: string }[] = [
  { key: "planned", label: "Планую подивитись" },
  { key: "watched", label: "Переглянуто" },
];

export function StatusToggle({ value, onChange }: { value: WatchStatus; onChange: (value: WatchStatus) => void }) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((o) => (
        <Pill key={o.key} flex label={o.label} selected={o.key === value} onPress={() => onChange(o.key)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", gap: 8 } });
