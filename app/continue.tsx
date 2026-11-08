import { router } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import EdgeFade from "@/components/EdgeFade";
import { Ionicons } from "@/components/icons/Ionicons";
import { holdMenu } from "@/components/ui/HoldMenu";
import { DeskDock } from "@/components/ui/DeskDock";
import { goDesk } from "@/utils/desks";
import { DOCK_CLEARANCE } from "@/components/ui/Dock";
import { Pill } from "@/components/ui/Pill";
import { TopBar, topBarSpace } from "@/components/ui/TopBar";
import { resumePoint, useLibraryStore } from "@/store/useLibraryStore";
import { FONT, RADIUS, SIDE, TYPE, useSoft } from "@/theme/soft";
import type { Video } from "@/types";

// «ПРОДОВЖИТИ»: only the videos begun and not finished, the most recently
// watched first, grouped Сьогодні / Цього тижня / Давно почате. A bar on the
// picture shows how far, the line under the title how much is left. Capsules
// filter by what is LEFT: до 10 хв, до 30 хв, довгі.
type Filter = "all" | "short" | "mid" | "long";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Усі" },
  { key: "short", label: "До 10 хв" },
  { key: "mid", label: "До 30 хв" },
  { key: "long", label: "Довгі" },
];

function leftText(sec: number): string {
  const m = Math.max(1, Math.ceil(sec / 60));
  if (m < 60) return `лишилось ${m} хв`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `лишилось ${h} год${mm ? ` ${mm} хв` : ""}`;
}

const remaining = (v: Video) => ((v.durationSec ?? 0) > 0 ? (v.durationSec as number) - (v.progressSec ?? 0) : null);

export default function ContinueScreen() {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const videos = useLibraryStore((s) => s.videos);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const updateVideo = useLibraryStore((s) => s.updateVideo);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = videos
      .filter((v) => resumePoint(v) > 0)
      .filter((v) => {
        const left = remaining(v);
        if (filter === "short") return left !== null && left <= 600;
        if (filter === "mid") return left !== null && left <= 1800;
        if (filter === "long") return left !== null && left > 1800;
        return true;
      })
      .filter((v) => !needle || v.title.toLowerCase().includes(needle))
      .sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0));
    const today = new Date().setHours(0, 0, 0, 0);
    const week = today - 6 * 86400000;
    const out: { title: string; items: Video[] }[] = [
      { title: "Сьогодні", items: list.filter((v) => (v.lastWatchedAt ?? 0) >= today) },
      { title: "Цього тижня", items: list.filter((v) => (v.lastWatchedAt ?? 0) < today && (v.lastWatchedAt ?? 0) >= week) },
      { title: "Давно почате", items: list.filter((v) => (v.lastWatchedAt ?? 0) < week) },
    ];
    return out.filter((g) => g.items.length > 0);
  }, [videos, filter, query]);

  const open = (v: Video) => router.push({ pathname: "/watch", params: { id: v.id, folder: v.tagIds[0] ?? "" } });

  return (
    <View style={[styles.root, { backgroundColor: S.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: topBarSpace(insets.top), paddingBottom: DOCK_CLEARANCE + insets.bottom + 24, gap: 10 }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.caps}>
          {FILTERS.map((f) => (
            <Pill key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
          ))}
        </ScrollView>

        {groups.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="play-outline" size={30} color={S.ink3} />
            <Text style={[TYPE.row, { color: S.ink3, textAlign: "center" }]}>
              {query || filter !== "all" ? "Нічого не знайдено" : "Тут з'являться відео, які ви почали дивитись і не докінчили"}
            </Text>
          </View>
        ) : (
          groups.map((g) => (
            <View key={g.title} style={{ gap: 10 }}>
              <Text style={[TYPE.meta, styles.groupTitle, { color: S.ink2 }]}>{g.title}</Text>
              {g.items.map((v) => (
                <Row
                  key={v.id}
                  video={v}
                  onPress={() => open(v)}
                  onHold={async (ref) => {
                    const key = await holdMenu(ref, [{ key: "drop", label: "Прибрати з «Продовжити»", icon: "close-circle-outline" }]);
                    // The video stays in the library; only the saved place is forgotten.
                    if (key === "drop") updateVideo(v.id, { progressSec: 0 });
                  }}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>

      <EdgeFade edge="top" color={S.bg} height={topBarSpace(insets.top) + 14} />
      <TopBar title="Продовжити" icon="play-outline" />

      <DeskDock
        desk="continue"
        onDesk={(k) => goDesk("continue", k)}
        query={query}
        onChangeQuery={setQuery}
        onAdd={() => router.push("/add-video")}
        bead={{ icon: "settings-outline", label: "Налаштування", onPress: () => router.push("/settings") }}
      />
    </View>
  );
}

function Row({ video, onPress, onHold }: { video: Video; onPress: () => void; onHold: (ref: React.RefObject<View | null>) => void }) {
  const S = useSoft();
  const ref = useRef<View>(null);
  const d = video.durationSec ?? 0;
  const p = video.progressSec ?? 0;
  const left = remaining(video);
  const site = video.siteName || (video.source === "youtube" ? "YouTube" : video.source === "tiktok" ? "TikTok" : "");
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      onLongPress={() => onHold(ref)}
      delayLongPress={350}
      style={({ pressed }) => [styles.row, { backgroundColor: S.card, boxShadow: S.shadow, opacity: pressed ? 0.9 : 1 }]}
    >
      <View style={[styles.thumb, { backgroundColor: S.fillSolid }]}>
        {video.thumbnailUrl ? <Image source={{ uri: video.thumbnailUrl }} style={StyleSheet.absoluteFill} /> : null}
        {d > 0 && (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, Math.round((p / d) * 100))}%`, backgroundColor: S.accent }]} />
          </View>
        )}
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: S.ink }]} numberOfLines={2}>
          {video.title}
        </Text>
        <Text style={[TYPE.small, { color: S.ink3 }]} numberOfLines={1}>
          {site}
          {left !== null ? `${site ? " · " : ""}${leftText(left)}` : ""}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  caps: { paddingHorizontal: SIDE, gap: 8 },
  groupTitle: { paddingHorizontal: SIDE, marginTop: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: SIDE, padding: 10, borderRadius: RADIUS.row },
  thumb: { width: 112, aspectRatio: 16 / 9, borderRadius: 12, overflow: "hidden", flexShrink: 0 },
  track: { position: "absolute", left: 0, right: 0, bottom: 0, height: 4, backgroundColor: "rgba(255,255,255,0.35)" },
  fill: { height: "100%" },
  body: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontFamily: FONT.semibold, fontWeight: "normal", fontSize: 14, lineHeight: 18, letterSpacing: -0.15 },
  empty: { alignItems: "center", gap: 10, paddingHorizontal: 40, paddingTop: 90 },
});
