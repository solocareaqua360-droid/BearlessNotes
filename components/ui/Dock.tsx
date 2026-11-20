import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@/components/icons/Ionicons";
import { FONT, softCursor, TYPE, useScheme, useSoft } from "@/theme/soft";

// THE DOCK - "what to do". Round 56 beads in `chrome` with the soft shadow;
// the search field is a capsule with the "+" set into its right end as a
// circle filled with `ink`. It rides up with the keyboard.
export const DOCK_BEAD = 56;
export const DOCK_BOTTOM = 22;
/** Space a scrolling list leaves below its last card for the dock. */
export const DOCK_CLEARANCE = DOCK_BEAD + DOCK_BOTTOM + 28;

export function Bead({ icon, onPress, label, active, size = 22 }: { icon: string; onPress: () => void; label: string; active?: boolean; size?: number }) {
  const S = useSoft();
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bead,
        { backgroundColor: S.chrome, boxShadow: S.shadow, transform: [{ scale: pressed ? 0.94 : 1 }] },
      ]}
    >
      <Ionicons name={icon as any} size={size} color={active ? S.accent : S.ink} />
      {active ? <View style={[styles.dot, { backgroundColor: S.accent }]} /> : null}
    </Pressable>
  );
}

export function Dock({
  query,
  onChangeQuery,
  onAdd,
  bead,
}: {
  query: string;
  onChangeQuery: (q: string) => void;
  onAdd: () => void;
  /** The round bead at the right: settings at the root, "back" once inside something. */
  bead: { icon: string; label: string; onPress: () => void };
}) {
  const S = useSoft();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardStickyView style={styles.sticky} offset={{ closed: -(insets.bottom + DOCK_BOTTOM), opened: -8 }}>
      <View style={styles.row} pointerEvents="box-none">
        <View style={[styles.search, { backgroundColor: S.chrome, boxShadow: S.shadow }]}>
          <Ionicons name="search" size={20} color={S.ink3} />
          <TextInput
            value={query}
            onChangeText={onChangeQuery}
            placeholder="Пошук"
            placeholderTextColor={S.ink3}
            style={[styles.input, { color: S.ink }]}
            returnKeyType="search"
            {...softCursor(scheme)}
          />
          {query.length > 0 && (
            <Pressable hitSlop={8} onPress={() => onChangeQuery("")}>
              <Ionicons name="close-circle" size={18} color={S.ink3} />
            </Pressable>
          )}
          <Pressable accessibilityLabel="Додати відео" onPress={onAdd} style={[styles.plus, { backgroundColor: S.ink }]}>
            <Ionicons name="add" size={24} color={S.chrome} />
          </Pressable>
        </View>
        <Bead icon={bead.icon} label={bead.label} onPress={bead.onPress} />
      </View>
    </KeyboardStickyView>
  );
}

/** The dock while videos are selected: a count line and two labelled actions. */
export function SelectionDock({
  count,
  onCancel,
  actions,
}: {
  count: number;
  onCancel: () => void;
  actions: { key: string; icon: string; label: string; onPress: () => void; destructive?: boolean }[];
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.sel, { bottom: insets.bottom + DOCK_BOTTOM }]} pointerEvents="box-none">
      <View style={[styles.selCard, { backgroundColor: S.chrome, boxShadow: S.shadow }]}>
        <View style={styles.selTop}>
          <Pressable onPress={onCancel} hitSlop={10}>
            <Text style={[TYPE.row, { color: S.ink2 }]}>Скасувати</Text>
          </Pressable>
          <Text style={[TYPE.row, { color: S.ink }]}>Обрано: {count}</Text>
        </View>
        <View style={styles.selActions}>
          {actions.map((a) => (
            <Pressable
              key={a.key}
              onPress={a.onPress}
              style={({ pressed }) => [styles.selBtn, { backgroundColor: S.fill, opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name={a.icon as any} size={19} color={a.destructive ? S.danger : S.ink} />
              <Text style={[TYPE.row, { fontSize: 15, color: a.destructive ? S.danger : S.ink }]}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sticky: { position: "absolute", left: 0, right: 0, bottom: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16 },
  bead: { width: DOCK_BEAD, height: DOCK_BEAD, borderRadius: DOCK_BEAD / 2, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: 14, right: 14, width: 7, height: 7, borderRadius: 3.5 },
  search: { flex: 1, height: DOCK_BEAD, borderRadius: DOCK_BEAD / 2, flexDirection: "row", alignItems: "center", paddingLeft: 18, paddingRight: 5, gap: 8 },
  input: { flex: 1, fontFamily: FONT.regular, fontWeight: "normal", fontSize: 15.5, padding: 0 },
  plus: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  sel: { position: "absolute", left: 16, right: 16 },
  selCard: { borderRadius: 28, padding: 14, gap: 12 },
  selTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 4 },
  selActions: { flexDirection: "row", gap: 8 },
  selBtn: { flex: 1, height: 50, borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
});
