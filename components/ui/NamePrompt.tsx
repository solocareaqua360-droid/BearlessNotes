import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassBlur, GlassPortal } from "@/components/ui/Glass";
import { FONT, RADIUS, softCursor, TYPE, useScheme, useSoft } from "@/theme/soft";

// «ПИТАННЯ» with something to type into: a name. Same card as ask().
export default function NamePrompt({
  visible,
  title,
  placeholder,
  initialValue = "",
  onCancel,
  onSave,
}: {
  visible: boolean;
  title: string;
  placeholder?: string;
  initialValue?: string;
  onCancel: () => void;
  onSave: (value: string) => void;
}) {
  const S = useSoft();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);
  if (!visible) return null;
  return (
    <GlassPortal>
      <View style={[StyleSheet.absoluteFill, { zIndex: 600 }]}>
        <GlassBlur intensity={40} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(17,24,39,0.45)" }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <KeyboardAvoidingView
          behavior="padding"
          style={[styles.frame, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}
          pointerEvents="box-none"
        >
          <View style={[styles.card, { backgroundColor: S.card, boxShadow: S.popShadow }]}>
            <Text style={[TYPE.title, { color: S.ink }]}>{title}</Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={placeholder}
              placeholderTextColor={S.ink3}
              autoFocus
              onSubmitEditing={() => value.trim() && onSave(value)}
              style={[styles.input, { backgroundColor: S.fill, color: S.ink }]}
              {...softCursor(scheme)}
            />
            <View style={styles.row}>
              <Pressable onPress={onCancel} style={[styles.btn, { backgroundColor: S.fill }]}>
                <Text style={[TYPE.row, { color: S.ink2 }]}>Скасувати</Text>
              </Pressable>
              <Pressable
                onPress={() => value.trim() && onSave(value)}
                style={[styles.btn, { backgroundColor: S.ink, opacity: value.trim() ? 1 : 0.35 }]}
              >
                <Text style={[TYPE.row, { color: S.chrome }]}>Готово</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  card: { width: "100%", maxWidth: 420, borderRadius: RADIUS.sheet, padding: 22, gap: 14 },
  input: { height: 52, borderRadius: 26, paddingHorizontal: 20, fontFamily: FONT.regular, fontWeight: "normal", fontSize: 16 },
  row: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
});
