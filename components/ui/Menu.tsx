import { Pressable, StyleSheet, Text, View } from "react-native";

import { Ionicons } from "@/components/icons/Ionicons";
import { FONT, RADIUS, TYPE, useSoft } from "@/theme/soft";

export type MenuEntry =
  | { key: string; label: string; icon?: string; checked?: boolean; suffix?: string; destructive?: boolean; onPress: () => void }
  | { section: string }
  | { rule: true };

// «МЕНЮ» - a short list of commands hung under the thing it belongs to.
// Soft panel: `chrome`, popShadow, radius 24, rows 48.
export function Menu({
  visible,
  onClose,
  entries,
  top,
  right,
}: {
  visible: boolean;
  onClose: () => void;
  entries: MenuEntry[];
  top: number;
  right: number;
}) {
  const S = useSoft();
  if (!visible) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[styles.panel, { top, right, backgroundColor: S.chrome, boxShadow: S.popShadow }]}>
        {entries.map((e, i) => {
          if ("section" in e) {
            return (
              <Text key={`s${i}`} style={[TYPE.small, styles.section, { color: S.ink3 }]}>
                {e.section}
              </Text>
            );
          }
          if ("rule" in e) return <View key={`r${i}`} style={[styles.rule, { backgroundColor: S.line }]} />;
          const tint = e.destructive ? S.danger : S.ink;
          return (
            <Pressable
              key={e.key}
              onPress={() => {
                onClose();
                e.onPress();
              }}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? S.fill : "transparent" }]}
            >
              {e.icon ? <Ionicons name={e.icon as any} size={19} color={e.destructive ? S.danger : S.ink2} /> : null}
              <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
                {e.label}
                {e.suffix ?? ""}
              </Text>
              {e.checked ? <Ionicons name="checkmark" size={18} color={S.ink} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: "absolute", width: 264, borderRadius: RADIUS.panel, padding: 4, zIndex: 30 },
  row: { height: 46, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14 },
  label: { flex: 1, fontFamily: FONT.medium, fontWeight: "normal", fontSize: 15 },
  section: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  rule: { height: 1, marginVertical: 4, marginHorizontal: 10 },
});
