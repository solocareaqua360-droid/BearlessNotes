import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassBlur } from "@/components/ui/Glass";
import { RADIUS, TYPE, useSoft } from "@/theme/soft";

// «ПИТАННЯ» - one question, answers as full-width ROWS (Android's own Alert
// silently drops a fourth button). A promise API replaces Alert.alert:
//   const ok = await confirm({ title, message, confirm: "Видалити", destructive: true });
//   const answer = await ask({ title, message, answers: [{ key, label, destructive? }] });
export type AskAnswer = { key: string; label: string; destructive?: boolean; primary?: boolean };
type AskRequest = {
  title: string;
  message?: string;
  answers: AskAnswer[];
  cancelLabel?: string | null;
  resolve: (key: string | null) => void;
};

let show: ((r: AskRequest) => void) | null = null;

export function ask(opts: {
  title: string;
  message?: string;
  answers: AskAnswer[];
  cancelLabel?: string | null;
}): Promise<string | null> {
  return new Promise((resolve) => {
    if (!show) return resolve(null);
    show({ ...opts, resolve });
  });
}

export async function confirm(opts: {
  title: string;
  message?: string;
  confirm?: string;
  destructive?: boolean;
}): Promise<boolean> {
  const key = await ask({
    title: opts.title,
    message: opts.message,
    answers: [{ key: "yes", label: opts.confirm ?? "Так", destructive: opts.destructive, primary: !opts.destructive }],
  });
  return key === "yes";
}

export function notify(title: string, message?: string): Promise<string | null> {
  return ask({ title, message, answers: [{ key: "ok", label: "Гаразд", primary: true }], cancelLabel: null });
}

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

export function AskHost() {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const [req, setReq] = useState<AskRequest | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const current = useRef<AskRequest | null>(null);

  useEffect(() => {
    show = (r) => {
      current.current = r;
      setReq(r);
      progress.setValue(0);
      Animated.timing(progress, { toValue: 1, duration: 220, easing: EASE, useNativeDriver: true }).start();
    };
    return () => {
      show = null;
    };
  }, [progress]);

  const close = (key: string | null) => {
    const r = current.current;
    if (!r) return;
    current.current = null;
    Animated.timing(progress, { toValue: 0, duration: 140, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
      () => setReq(null)
    );
    r.resolve(key);
  };

  if (!req) return null;
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });

  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
        <GlassBlur intensity={40} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(17,24,39,0.45)" }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={() => req.cancelLabel !== null && close(null)} />
      </Animated.View>
      <Animated.View
        style={[styles.card, { backgroundColor: S.card, boxShadow: S.popShadow, opacity: progress, transform: [{ scale }] }]}
      >
        <Text style={[TYPE.title, { color: S.ink }]}>{req.title}</Text>
        {req.message ? <Text style={[TYPE.body, styles.message, { color: S.ink2 }]}>{req.message}</Text> : null}
        <View style={styles.answers}>
          {req.answers.map((a) => (
            <Pressable
              key={a.key}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                close(a.key);
              }}
              style={({ pressed }) => [
                styles.answer,
                { backgroundColor: a.primary ? S.ink : S.fill, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={[TYPE.row, { color: a.primary ? S.card : a.destructive ? S.danger : S.ink }]}>{a.label}</Text>
            </Pressable>
          ))}
          {req.cancelLabel !== null && (
            <Pressable onPress={() => close(null)} style={({ pressed }) => [styles.answer, { backgroundColor: S.fill, opacity: pressed ? 0.8 : 1 }]}>
              <Text style={[TYPE.row, { color: S.ink2 }]}>{req.cancelLabel ?? "Скасувати"}</Text>
            </Pressable>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { justifyContent: "center", alignItems: "center", paddingHorizontal: 20, zIndex: 1000 },
  card: { width: "100%", maxWidth: 420, borderRadius: RADIUS.sheet, padding: 22, gap: 8 },
  message: { marginTop: 2 },
  answers: { marginTop: 14, gap: 8 },
  answer: { minHeight: 52, borderRadius: RADIUS.answer, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
});
