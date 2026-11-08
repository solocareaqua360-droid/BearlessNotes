import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import EdgeFade from "@/components/EdgeFade";
import { Ionicons } from "@/components/icons/Ionicons";
import { notify } from "@/components/ui/Ask";
import { DOCK_BEAD, DOCK_BOTTOM } from "@/components/ui/Dock";
import { TopBar, topBarSpace } from "@/components/ui/TopBar";
import { addFromSubscription } from "@/services/channels";
import { errorMessage } from "@/services/errorMessage";
import { listSubscriptions, type Subscription } from "@/services/youtubeApi";
import { useChannelsStore } from "@/store/useChannelsStore";
import { FONT, RADIUS, SIDE, TYPE, useSoft } from "@/theme/soft";

// PICK CHANNELS from the user's YouTube subscriptions (after the Google sign-in):
// the ones already followed are marked, the rest can be ticked, then «Додати».
export default function ImportSubscriptionsScreen() {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const followed = useChannelsStore((s) => s.channels);
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    listSubscriptions()
      .then(setSubs)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const have = useMemo(() => new Set(followed.map((c) => c.id)), [followed]);
  const free = useMemo(() => (subs ?? []).filter((s) => !have.has(s.channelId)), [subs, have]);
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allPicked = free.length > 0 && free.every((s) => picked.has(s.channelId));

  const add = async () => {
    const chosen = free.filter((s) => picked.has(s.channelId));
    if (!chosen.length) return;
    setProgress({ done: 0, total: chosen.length });
    let done = 0;
    // A few at a time: gentle on the network and on the day's quota.
    const queue = [...chosen];
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        await addFromSubscription(s).catch(() => {});
        done += 1;
        setProgress({ done, total: chosen.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setProgress(null);
    await notify("Готово", `Додано каналів: ${chosen.length}`);
    router.back();
  };

  return (
    <View style={[styles.root, { backgroundColor: S.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: topBarSpace(insets.top), paddingBottom: insets.bottom + DOCK_BEAD + DOCK_BOTTOM + 40, gap: 8 }}
      >
        {error ? (
          <Text style={[TYPE.row, styles.note, { color: S.danger }]}>Не вдалося прочитати підписки: {error}</Text>
        ) : subs === null ? (
          <View style={styles.note}>
            <ActivityIndicator color={S.ink2} />
          </View>
        ) : subs.length === 0 ? (
          <Text style={[TYPE.row, styles.note, { color: S.ink3 }]}>На цьому акаунті немає підписок.</Text>
        ) : (
          <>
            <Pressable onPress={() => setPicked(allPicked ? new Set() : new Set(free.map((s) => s.channelId)))} style={styles.all}>
              <Text style={[TYPE.row, { color: S.ink, fontFamily: FONT.semibold }]}>{allPicked ? "Зняти вибір" : `Вибрати всі (${free.length})`}</Text>
            </Pressable>
            {subs.map((s) => {
              const already = have.has(s.channelId);
              const on = picked.has(s.channelId);
              return (
                <Pressable
                  key={s.channelId}
                  disabled={already}
                  onPress={() => toggle(s.channelId)}
                  style={[styles.row, { backgroundColor: S.card, boxShadow: S.shadow, opacity: already ? 0.5 : 1 }]}
                >
                  {s.avatarUrl ? <Image source={{ uri: s.avatarUrl }} style={styles.avatar} /> : <View style={[styles.avatar, { backgroundColor: S.fillSolid }]} />}
                  <Text style={[TYPE.row, { flex: 1, color: S.ink }]} numberOfLines={1}>
                    {s.title}
                  </Text>
                  {already ? (
                    <Text style={[TYPE.small, { color: S.ink3 }]}>Додано</Text>
                  ) : (
                    <View style={[styles.check, on ? { backgroundColor: S.ink, borderColor: S.ink } : { borderColor: S.ink3 }]}>
                      {on && <Ionicons name="checkmark" size={14} color={S.chrome} />}
                    </View>
                  )}
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>

      <EdgeFade edge="top" color={S.bg} height={topBarSpace(insets.top) + 14} />
      <TopBar title="З моїх підписок" onBack={() => router.back()} />

      {picked.size > 0 && (
        <View style={[styles.bar, { bottom: insets.bottom + DOCK_BOTTOM }]} pointerEvents="box-none">
          <Pressable onPress={add} disabled={!!progress} style={[styles.addBtn, { backgroundColor: S.ink }]}>
            {progress ? <ActivityIndicator color={S.chrome} /> : null}
            <Text style={[TYPE.row, { color: S.chrome, fontFamily: FONT.semibold }]}>
              {progress ? `Додаю ${progress.done}/${progress.total}…` : `Додати (${picked.size})`}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  note: { alignItems: "center", paddingHorizontal: SIDE + 20, paddingTop: 60, textAlign: "center" },
  all: { marginHorizontal: SIDE, height: 40, justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: SIDE, padding: 10, borderRadius: RADIUS.row },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  bar: { position: "absolute", left: SIDE, right: SIDE },
  addBtn: { height: DOCK_BEAD, borderRadius: DOCK_BEAD / 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
});
