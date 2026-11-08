import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { Ionicons } from "@/components/icons/Ionicons";
import { TYPE, useSoft } from "@/theme/soft";

// A pill: height 38, radius 19. Selected = the ink fill with the light
// text; the others sit on fillSolid. Never an accent colour.
export function Pill({
  label,
  selected,
  onPress,
  onLongPress,
  icon,
  style,
  flex,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /** A small icon before the label. */
  icon?: string;
  style?: StyleProp<ViewStyle>;
  flex?: boolean;
}) {
  const S = useSoft();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.pill,
        flex && { flex: 1 },
        { backgroundColor: selected ? S.ink : S.fillSolid, opacity: pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon as any} size={16} color={selected ? S.chrome : S.ink2} /> : null}
      <Text style={[TYPE.row, { fontSize: 14, color: selected ? S.chrome : S.ink2 }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { height: 38, borderRadius: 19, paddingHorizontal: 16, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
});
