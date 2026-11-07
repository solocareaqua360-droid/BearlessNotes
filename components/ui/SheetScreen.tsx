import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { ScrollView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassBlur } from "@/components/ui/Glass";
import { RADIUS, TYPE, useSoft } from "@/theme/soft";

// «АРКУШ» - a panel of content, centred (the screen shrunk to its middle),
// over a blurred, dimmed backdrop. The keyboard moves the whole frame, never
// the sheet's margin.
export function SheetScreen({
  title,
  cancelLabel = "Скасувати",
  doneLabel,
  onDone,
  doneDisabled,
  children,
  overlay,
}: {
  title: string;
  cancelLabel?: string;
  doneLabel?: string;
  onDone?: () => void;
  doneDisabled?: boolean;
  children: ReactNode;
  overlay?: ReactNode;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  return (
    <View style={StyleSheet.absoluteFill}>
      <GlassBlur intensity={40} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(17,24,39,0.45)" }]} />
      <Pressable style={StyleSheet.absoluteFill} onPress={() => router.back()} />
      <KeyboardAvoidingView
        behavior="padding"
        style={[styles.frame, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, { backgroundColor: S.card, boxShadow: S.popShadow }]}>
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} hitSlop={8} style={[styles.headBtn, { backgroundColor: S.fill }]}>
              <Text style={[TYPE.row, { fontSize: 14.5, color: S.ink2 }]}>{cancelLabel}</Text>
            </Pressable>
            <Text style={[TYPE.cardTitle, styles.title, { color: S.ink }]} numberOfLines={1}>
              {title}
            </Text>
            {doneLabel ? (
              <Pressable
                onPress={onDone}
                disabled={doneDisabled}
                hitSlop={8}
                style={[styles.headBtn, { backgroundColor: S.ink, opacity: doneDisabled ? 0.35 : 1 }]}
              >
                <Text style={[TYPE.row, { fontSize: 14.5, color: S.chrome }]}>{doneLabel}</Text>
              </Pressable>
            ) : (
              <View style={{ width: 84 }} />
            )}
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      {overlay}
    </View>
  );
}

/** A labelled block inside a sheet. */
export function Field({ label, children }: { label?: string; children: ReactNode }) {
  const S = useSoft();
  return (
    <View style={{ gap: 8 }}>
      {label ? <Text style={[TYPE.small, { color: S.ink2, paddingHorizontal: 4 }]}>{label}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 16 },
  sheet: { width: "100%", maxWidth: 560, maxHeight: "100%", borderRadius: RADIUS.sheet, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6 },
  headBtn: { minWidth: 84, height: 38, borderRadius: 19, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center" },
  content: { padding: 16, paddingTop: 10, gap: 16 },
});
