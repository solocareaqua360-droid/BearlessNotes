import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@/components/icons/Ionicons";
import { Bead, DOCK_BEAD, DOCK_BOTTOM } from "@/components/ui/Dock";
import { FONT, softCursor, useScheme, useSoft } from "@/theme/soft";

// THE DESK DOCK (a small version of mindEva's): one white pill on the left with
// the DESKS - each a round place, the one you are on held by a grey capsule that
// slides to the desk you pick - then, after a hairline, the search lens; on the
// right "+" (filled with ink) and one more round bead. The lens opens the pill
// into a search field. Only the desks that exist are drawn; Канали and Навчання
// join the pill when their screens do.
export type DeskKey = "home" | "continue";

const DESKS: { key: DeskKey; icon: string; label: string }[] = [
  { key: "home", icon: "home-outline", label: "Головна" },
  { key: "continue", icon: "play-outline", label: "Продовжити" },
];

const PAD = 4;
const DESK_W = 52;
const DESK_H = DOCK_BEAD - PAD * 2;

export function DeskDock({
  desk,
  onDesk,
  query,
  onChangeQuery,
  onAdd,
  bead,
}: {
  desk: DeskKey;
  onDesk: (key: DeskKey) => void;
  query: string;
  onChangeQuery: (q: string) => void;
  onAdd: () => void;
  bead: { icon: string; label: string; onPress: () => void };
}) {
  const S = useSoft();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  const [searching, setSearching] = useState(false);
  const open = searching || query.length > 0;

  // The capsule under the current desk.
  const index = Math.max(0, DESKS.findIndex((d) => d.key === desk));
  const at = useSharedValue(index);
  useEffect(() => {
    at.value = withTiming(index, { duration: 240, easing: Easing.out(Easing.cubic) });
  }, [index, at]);
  const capsule = useAnimatedStyle(() => ({ left: PAD + at.value * DESK_W }));

  const closeSearch = () => {
    onChangeQuery("");
    setSearching(false);
  };

  return (
    <KeyboardStickyView style={styles.sticky} offset={{ closed: -(insets.bottom + DOCK_BOTTOM), opened: -8 }}>
      <View style={styles.row} pointerEvents="box-none">
        <View style={[styles.pill, open && { flex: 1 }, { backgroundColor: S.chrome, boxShadow: S.shadow }]}>
          {open ? (
            <>
              <View style={styles.lensBox}>
                <Ionicons name="search" size={20} color={S.ink3} />
              </View>
              <TextInput
                value={query}
                onChangeText={onChangeQuery}
                placeholder="Пошук"
                placeholderTextColor={S.ink3}
                autoFocus={searching}
                style={[styles.input, { color: S.ink }]}
                returnKeyType="search"
                {...softCursor(scheme)}
              />
              <Pressable onPress={closeSearch} hitSlop={8} accessibilityLabel="Закрити пошук" style={styles.lensBox}>
                <Ionicons name="close-circle" size={20} color={S.ink3} />
              </Pressable>
            </>
          ) : (
            <>
              <Animated.View style={[styles.capsule, { backgroundColor: S.fillSolid }, capsule]} />
              {DESKS.map((d) => (
                <Pressable key={d.key} onPress={() => (d.key === desk ? null : onDesk(d.key))} accessibilityLabel={d.label} style={styles.desk}>
                  <Ionicons name={d.icon as any} size={22} color={d.key === desk ? S.ink : S.ink2} />
                </Pressable>
              ))}
              <View style={[styles.hair, { backgroundColor: S.line }]} />
              <Pressable onPress={() => setSearching(true)} accessibilityLabel="Пошук" style={styles.lensBox}>
                <Ionicons name="search" size={20} color={S.ink2} />
              </Pressable>
            </>
          )}
        </View>
        {!open && <View style={{ flex: 1 }} pointerEvents="none" />}
        <Pressable accessibilityLabel="Додати відео" onPress={onAdd} style={[styles.plus, { backgroundColor: S.ink }]}>
          <Ionicons name="add" size={26} color={S.chrome} />
        </Pressable>
        <Bead icon={bead.icon} label={bead.label} onPress={bead.onPress} />
      </View>
    </KeyboardStickyView>
  );
}

const styles = StyleSheet.create({
  sticky: { position: "absolute", left: 0, right: 0, bottom: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16 },
  pill: { height: DOCK_BEAD, borderRadius: DOCK_BEAD / 2, flexDirection: "row", alignItems: "center", paddingHorizontal: PAD },
  capsule: { position: "absolute", top: PAD, width: DESK_W, height: DESK_H, borderRadius: DESK_H / 2 },
  desk: { width: DESK_W, height: DESK_H, alignItems: "center", justifyContent: "center" },
  hair: { width: 1, height: 24, marginHorizontal: 4 },
  lensBox: { width: 44, height: DESK_H, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, fontFamily: FONT.regular, fontWeight: "normal", fontSize: 15.5, padding: 0 },
  plus: { width: DOCK_BEAD, height: DOCK_BEAD, borderRadius: DOCK_BEAD / 2, alignItems: "center", justifyContent: "center" },
});
