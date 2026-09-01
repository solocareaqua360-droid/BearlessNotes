import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, radius } from "@/constants/theme";

interface FloatingIslandProps {
  onTagsPress: () => void;
  onSearchPress: () => void;
  onAddPress: () => void;
  onFiltersPress: () => void;
}

export function FloatingIsland({
  onTagsPress,
  onSearchPress,
  onAddPress,
  onFiltersPress,
}: FloatingIslandProps) {
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.island}>
        <IslandButton icon="pricetags-outline" onPress={onTagsPress} />
        <IslandButton icon="search" onPress={onSearchPress} />
        <IslandButton icon="add" onPress={onAddPress} accent />
        <IslandButton icon="options-outline" onPress={onFiltersPress} />
      </View>
    </View>
  );
}

function IslandButton({
  icon,
  onPress,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.button, accent && styles.buttonAccent]}
      hitSlop={8}
    >
      <Ionicons name={icon} size={accent ? 26 : 20} color={accent ? "#fff" : colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: "center",
  },
  island: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  button: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonAccent: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accent,
  },
});
