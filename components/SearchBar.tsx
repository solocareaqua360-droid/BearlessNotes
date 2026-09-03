import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { colors, radius, spacing } from "@/constants/theme";

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onClear?: () => void;
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = "Пошук відео",
  autoFocus = false,
  onClear,
}: SearchBarProps) {
  return (
    <View style={styles.wrap}>
      <Ionicons name="search" size={18} color={colors.searchIcon} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        autoFocus={autoFocus}
      />
      {value.length > 0 && onClear && (
        <Pressable onPress={onClear} hitSlop={8} style={styles.clearButton}>
          <Ionicons name="close" size={12} color="#fff" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.pillInactive,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    height: 52,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
  },
  clearButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.textMuted,
    alignItems: "center",
    justifyContent: "center",
  },
});
