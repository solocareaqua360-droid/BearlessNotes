import { Ionicons } from "@expo/vector-icons";
import { useRef } from "react";
import { PanResponder, StyleSheet, View } from "react-native";

import { colors } from "@/constants/theme";

interface FilterTabProps {
  onOpen: () => void;
}

const SWIPE_OPEN_THRESHOLD = 24;

export function FilterTab({ onOpen }: FilterTabProps) {
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx > SWIPE_OPEN_THRESHOLD || Math.abs(gesture.dx) < 4) {
          onOpen();
        }
      },
    })
  ).current;

  return (
    <View style={styles.wrap} {...panResponder.panHandlers}>
      <Ionicons name="funnel" size={16} color={colors.iconDark} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    bottom: 29,
    width: 60,
    height: 64,
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 2, height: 0 },
    elevation: 8,
  },
});
