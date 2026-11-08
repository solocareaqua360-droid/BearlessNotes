import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@/components/icons/Ionicons";
import { GlassBlur, GlassPortal } from "@/components/ui/Glass";
import { tagIconOptions } from "@/constants/theme";
import { RADIUS, TYPE, useSoft } from "@/theme/soft";

// «ІКОНКА»: a card with the grid of icons the folders use. Tap one to take it;
// «Без іконки» clears it. Same card as ask().
export default function IconPicker({
  visible,
  title,
  current,
  onPick,
  onCancel,
}: {
  visible: boolean;
  title: string;
  current?: string | null;
  onPick: (icon: string | null) => void;
  onCancel: () => void;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  if (!visible) return null;
  return (
    <GlassPortal>
      <View style={[StyleSheet.absoluteFill, { zIndex: 600 }]}>
        <GlassBlur intensity={40} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(17,24,39,0.45)" }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={[styles.frame, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
          <View style={[styles.card, { backgroundColor: S.card, boxShadow: S.popShadow }]}>
            <Text style={[TYPE.title, { color: S.ink }]}>{title}</Text>
            <ScrollView style={{ maxHeight: Math.round(height * 0.5) }} showsVerticalScrollIndicator={false}>
              <View style={styles.grid}>
                {tagIconOptions.map((name) => {
                  const selected = name === current;
                  return (
                    <View key={name} style={styles.cellWrap}>
                      <Pressable
                        onPress={() => onPick(name)}
                        style={[styles.cell, { backgroundColor: selected ? S.ink : S.fill }]}
                        accessibilityLabel={name}
                      >
                        <Ionicons name={name as any} size={21} color={selected ? S.chrome : S.ink2} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
            <View style={styles.buttons}>
              <Pressable onPress={() => onPick(null)} style={[styles.button, { backgroundColor: S.fill }]}>
                <Text style={[TYPE.row, { color: S.ink2 }]}>Без іконки</Text>
              </Pressable>
              <Pressable onPress={onCancel} style={[styles.button, { backgroundColor: S.fill }]}>
                <Text style={[TYPE.row, { color: S.ink2 }]}>Скасувати</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 20 },
  card: { width: "100%", maxWidth: 420, borderRadius: RADIUS.sheet, padding: 22, gap: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cellWrap: { width: "16.66%", padding: 4, aspectRatio: 1 },
  cell: { flex: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  buttons: { flexDirection: "row", gap: 8 },
  button: { flex: 1, minHeight: 48, borderRadius: RADIUS.answer, alignItems: "center", justifyContent: "center" },
});
