import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import EdgeFade from "@/components/EdgeFade";
import { TopBar, topBarSpace } from "@/components/ui/TopBar";
import { useLibraryStore } from "@/store/useLibraryStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { RADIUS, SIDE, TYPE, useSoft } from "@/theme/soft";
import { supportsPip } from "@/utils/cinemaNative";

const SAMPLE = { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Відео для перевірки" };

// A TEMPORARY test screen for the player: does YouTube play inside the app,
// keep playing in the capsule while the user walks the app, and in the
// system's small window. Goes away when the cinema screens exist.
export default function PlayerTestScreen() {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const videos = useLibraryStore((s) => s.videos).filter((v) => v.source === "youtube" && !v.deletedAt);
  const open = usePlayerStore((s) => s.open);

  return (
    <View style={[styles.container, { backgroundColor: S.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: topBarSpace(insets.top), paddingBottom: insets.bottom + 120, gap: 12 }}
      >
        <View style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow }]}>
          <Text style={[TYPE.meta, { color: S.ink2 }]}>Що перевірити</Text>
          <Text style={[TYPE.row, { color: S.ink, marginTop: 8 }]}>
            1. Відео грає тут.{"\n"}2. Кнопка «⌄» згортає його в капсулу; ходи застосунком — звук не має зупинитись.{"\n"}3. Кнопка «⤡» або «Додому»
            під час відео — маленьке вікно поверх усього; чи грає воно.
          </Text>
          <Text style={[TYPE.small, { color: S.ink3, marginTop: 8 }]}>
            Системне вікно в цій збірці: {supportsPip ? "є" : "немає (стара збірка)"}
          </Text>
        </View>

        <Pressable
          onPress={() => open(SAMPLE.url, SAMPLE.title)}
          style={({ pressed }) => [styles.card, { backgroundColor: pressed ? S.fill : S.card, boxShadow: S.shadow }]}
        >
          <Text style={[TYPE.row, { color: S.ink }]}>▶  {SAMPLE.title}</Text>
        </Pressable>

        {videos.map((v) => (
          <Pressable
            key={v.id}
            onPress={() => open(v.url, v.title)}
            style={({ pressed }) => [styles.card, { backgroundColor: pressed ? S.fill : S.card, boxShadow: S.shadow }]}
          >
            <Text style={[TYPE.row, { color: S.ink }]} numberOfLines={2}>
              ▶  {v.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <EdgeFade edge="top" color={S.bg} height={topBarSpace(insets.top) + 14} />
      <TopBar title="Тест плеєра" onBack={() => router.back()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { marginHorizontal: SIDE, borderRadius: RADIUS.card, padding: 16 },
});
