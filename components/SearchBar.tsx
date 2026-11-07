import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { Ionicons } from "@/components/icons/Ionicons";
import { FONT, softCursor, useScheme, useSoft } from "@/theme/soft";

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onClear?: () => void;
}

// A soft field: a 48-high capsule on the faint fill, caret in the accent.
export function SearchBar({ value, onChangeText, placeholder = "Пошук", autoFocus = false, onClear }: SearchBarProps) {
  const S = useSoft();
  const scheme = useScheme();
  return (
    <View style={[styles.wrap, { backgroundColor: S.fill }]}>
      <Ionicons name="search" size={18} color={S.ink3} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={S.ink3}
        style={[styles.input, { color: S.ink }]}
        autoFocus={autoFocus}
        {...softCursor(scheme)}
      />
      {value.length > 0 && (
        <Pressable onPress={onClear ?? (() => onChangeText(""))} hitSlop={10}>
          <Ionicons name="close-circle" size={18} color={S.ink3} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 24, paddingHorizontal: 16, height: 48 },
  input: { flex: 1, fontFamily: FONT.regular, fontWeight: "normal", fontSize: 15.5, padding: 0 },
});
