import * as Updates from "expo-updates";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Ionicons } from "@/components/icons/Ionicons";
import { RADIUS, SIDE, TYPE, useSoft } from "@/theme/soft";

type Phase = "idle" | "checking" | "downloading" | "uptodate" | "error";

// One button: check -> download -> restart into the new version. The current
// version is shown above it so there is never any doubt what is installed.
export function UpdateSection() {
  const S = useSoft();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");

  const enabled = Updates.isEnabled;
  const id = Updates.updateId ? Updates.updateId.slice(0, 8) : "вбудована збірка";
  const stamp = Updates.createdAt
    ? Updates.createdAt.toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;

  const run = async () => {
    setError("");
    try {
      setPhase("checking");
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) return setPhase("uptodate");
      setPhase("downloading");
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const busy = phase === "checking" || phase === "downloading";
  const label =
    phase === "checking" ? "Перевіряю…" : phase === "downloading" ? "Завантажую…" : phase === "uptodate" ? "Найновіша версія" : "Оновити";

  return (
    <View style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow }]}>
      <Text style={[TYPE.meta, { color: S.ink2, marginBottom: 10 }]}>Оновлення</Text>
      <View style={styles.info}>
        <Text style={[TYPE.row, { color: S.ink }]}>Версія {Updates.runtimeVersion ?? "—"}</Text>
        <Text style={[TYPE.small, { color: S.ink3 }]}>
          {enabled ? `Оновлення ${id}${stamp ? ` · ${stamp}` : ""}` : "Режим розробки: оновлення вимкнені"}
        </Text>
      </View>
      <Pressable
        onPress={run}
        disabled={!enabled || busy}
        style={({ pressed }) => [styles.btn, { backgroundColor: S.ink, opacity: !enabled ? 0.35 : pressed ? 0.85 : 1 }]}
      >
        {busy ? <ActivityIndicator size="small" color={S.chrome} /> : <Ionicons name={phase === "uptodate" ? "checkmark" : "refresh-outline"} size={19} color={S.chrome} />}
        <Text style={[TYPE.row, { color: S.chrome }]}>{label}</Text>
      </Pressable>
      {phase === "error" ? <Text style={[TYPE.small, { color: S.danger, marginTop: 8 }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: SIDE, borderRadius: RADIUS.card, padding: 16 },
  info: { gap: 3, marginBottom: 14 },
  btn: { height: 50, borderRadius: 25, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
});
