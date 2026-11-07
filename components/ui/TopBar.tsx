import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWindowDimensions } from "react-native";
import type { ReactNode } from "react";

import { Ionicons } from "@/components/icons/Ionicons";
import { TYPE, useSoft } from "@/theme/soft";

// THE TOP BAR - "where am I": one capsule (radius 23, 46 high) at the top,
// back at its left end, the title in the middle, extras at its right end.
export const TOP_NAV_H = 46;
export const topBarTop = (insetTop: number) => insetTop + 4;
/** Where content starts below the bar. */
export const topBarSpace = (insetTop: number) => insetTop + 4 + TOP_NAV_H + 12;

export function TopBar({
  title,
  icon,
  onBack,
  right,
  left,
}: {
  title: string;
  icon?: string;
  onBack?: () => void;
  left?: ReactNode;
  right?: ReactNode;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const frame = Math.min(width - 40, 560);
  return (
    <View style={[styles.wrap, { top: topBarTop(insets.top) }]} pointerEvents="box-none">
      <View style={[styles.bar, { width: frame, backgroundColor: S.chrome, boxShadow: S.shadow }]}>
        <View style={styles.side}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Назад" style={styles.sideBtn}>
              <Ionicons name="chevron-back" size={24} color={S.ink} />
            </Pressable>
          ) : (
            left
          )}
        </View>
        <View style={styles.titleWrap}>
          {icon ? <Ionicons name={icon as any} size={21} color={S.ink} /> : null}
          <Text style={[TYPE.cardTitle, styles.title, { color: S.ink }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View style={[styles.side, { alignItems: "flex-end", flexDirection: "row", justifyContent: "flex-end" }]}>{right}</View>
      </View>
    </View>
  );
}

export function BarButton({ icon, onPress, label, size = 21, textLabel }: { icon: string; onPress: () => void; label: string; size?: number; textLabel?: string }) {
  const S = useSoft();
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6} style={styles.sideBtn}>
      {textLabel ? (
        <Text style={[TYPE.row, { fontSize: 15, color: S.ink }]}>{textLabel}</Text>
      ) : (
        <Ionicons name={icon as any} size={size} color={S.ink} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 5 },
  bar: { height: TOP_NAV_H, borderRadius: 23, flexDirection: "row", alignItems: "center", paddingHorizontal: 6 },
  side: { minWidth: 50, flexShrink: 0, justifyContent: "center" },
  sideBtn: { minWidth: 40, height: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  titleWrap: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minWidth: 0 },
  title: { flexShrink: 1, textAlign: "center" },
});
