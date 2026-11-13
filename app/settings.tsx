import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import EdgeFade from "@/components/EdgeFade";
import { Ionicons } from "@/components/icons/Ionicons";
import { TagsDrawer } from "@/components/TagsDrawer";
import { UpdateSection } from "@/components/UpdateSection";
import { notify } from "@/components/ui/Ask";
import { Pill } from "@/components/ui/Pill";
import { TopBar, topBarSpace } from "@/components/ui/TopBar";
import { forgetCloud, syncNow } from "@/services/cloudSync";
import { signInWithGoogle, signOutOfGoogle } from "@/services/googleAuth";
import { useSyncStore } from "@/store/useSyncStore";
import { useGoogleStore } from "@/store/useGoogleStore";
import { errorMessage } from "@/services/errorMessage";
import { useLibraryStore } from "@/store/useLibraryStore";
import { RADIUS, SIDE, TYPE, useSoft } from "@/theme/soft";
import { OpenVideoMode, ThemePreference } from "@/types";

const THEME_OPTIONS: { key: ThemePreference; label: string }[] = [
  { key: "light", label: "Світла" },
  { key: "system", label: "Системна" },
  { key: "dark", label: "Темна" },
];

const OPEN_MODE_OPTIONS: { key: OpenVideoMode; label: string }[] = [
  { key: "in_app", label: "У застосунку" },
  { key: "external", label: "YouTube/TikTok" },
];

export default function SettingsScreen() {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const settings = useLibraryStore((s) => s.settings);
  const updateSettings = useLibraryStore((s) => s.updateSettings);
  const videos = useLibraryStore((s) => s.videos);
  const tags = useLibraryStore((s) => s.tags);
  const removeTag = useLibraryStore((s) => s.removeTag);

  const [tagsDrawerVisible, setTagsDrawerVisible] = useState(false);
  const [drawerSelection, setDrawerSelection] = useState<string[]>([]);
  const [signingIn, setSigningIn] = useState(false);

  const unsortedCount = videos.filter((v) => v.tagIds.length === 0).length;

  // THE GOOGLE SIGN-IN is the new one (reads the YouTube subscriptions); the old viBo sign-in
  // went through a server that no longer exists.
  const googleSignedIn = useGoogleStore((g) => !!g.refreshToken);
  const hasIdentity = useGoogleStore((g) => !!g.idToken);
  const sync = useSyncStore((x) => ({ status: x.status, error: x.error, lastSyncAt: x.lastSyncAt, email: x.email }));
  const [syncing, setSyncing] = useState(false);
  const runSync = async () => {
    setSyncing(true);
    const r = await syncNow();
    setSyncing(false);
    notify(r.ok ? "Синхронізовано" : "Синхронізація не вдалася", r.ok ? `Відправлено: ${r.sent}, отримано: ${r.got}` : r.error ?? "");
  };
  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      if (await signInWithGoogle()) {
        void syncNow();
        router.push("/import-subscriptions");
      }
    } catch (e) {
      notify("Не вдалося увійти через Google", errorMessage(e));
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: S.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: topBarSpace(insets.top), paddingBottom: insets.bottom + 40, gap: 12 }}
      >
        <View style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow }]}>
          {googleSignedIn ? (
            <View style={styles.accountRow}>
              <View style={[styles.avatar, { backgroundColor: S.fillSolid }]}>
                <Ionicons name="logo-google" size={20} color={S.ink2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[TYPE.row, { color: S.ink }]}>Google підключено</Text>
                <Text style={[TYPE.small, { color: S.ink3, marginTop: 2 }]}>Підписки YouTube доступні в «Каналах»</Text>
              </View>
              <Pressable onPress={() => { signOutOfGoogle(); forgetCloud(); }} style={[styles.signOut, { backgroundColor: S.fill }]}>
                <Text style={[TYPE.row, { fontSize: 14, color: S.ink }]}>Вийти</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.signIn} onPress={handleSignIn} disabled={signingIn}>
              {signingIn ? <ActivityIndicator size="small" color={S.ink} /> : <Ionicons name="logo-google" size={20} color={S.ink} />}
              <Text style={[TYPE.row, { color: S.ink }]}>{signingIn ? "Вхід…" : "Увійти через Google"}</Text>
            </Pressable>
          )}
        </View>

        {googleSignedIn && (
          <View style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow }]}>
            <View style={styles.accountRow}>
              <View style={[styles.avatar, { backgroundColor: S.fillSolid }]}>
                <Ionicons name={"cloud" as any} size={20} color={S.ink2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[TYPE.row, { color: S.ink }]}>Синхронізація між телефонами</Text>
                <Text style={[TYPE.small, { color: S.ink3, marginTop: 2 }]} numberOfLines={3}>
                  {!hasIdentity
                    ? "Увійди ще раз, щоб увімкнути (потрібен дозвіл на email)"
                    : syncing || sync.status === "working"
                      ? "Синхронізую…"
                      : sync.status === "error"
                        ? sync.error ?? "Помилка"
                        : sync.lastSyncAt
                          ? `Востаннє: ${new Date(sync.lastSyncAt).toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                          : "Ще не синхронізовано"}
                </Text>
              </View>
              <Pressable onPress={hasIdentity ? runSync : handleSignIn} disabled={syncing || signingIn} style={[styles.signOut, { backgroundColor: S.fill }]}>
                <Text style={[TYPE.row, { fontSize: 14, color: S.ink }]}>{hasIdentity ? "Зараз" : "Увійти"}</Text>
              </Pressable>
            </View>
          </View>
        )}

        <UpdateSection />

        <Section title="Тема">
          <Segmented options={THEME_OPTIONS} value={settings.theme} onChange={(theme) => updateSettings({ theme })} />
        </Section>

        <Section title="Відкриття відео">
          <Segmented options={OPEN_MODE_OPTIONS} value={settings.openVideoMode} onChange={(openVideoMode) => updateSettings({ openVideoMode })} />
        </Section>

        <View style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow, padding: 6 }]}>
          <ListRow icon="pricetag-outline" label="Редагувати смарт-папки" onPress={() => setTagsDrawerVisible(true)} />
          <ListRow
            icon="arrow-down"
            label="Невідсортоване"
            count={unsortedCount}
            onPress={() => router.push({ pathname: "/", params: { unsorted: "1" } })}
          />
          <ListRow icon="play-outline" label="Тест плеєра" onPress={() => router.push("/player-test")} />
        </View>
      </ScrollView>

      <EdgeFade edge="top" color={S.bg} height={topBarSpace(insets.top) + 14} />
      <TopBar title="Налаштування" onBack={() => router.back()} />

      <TagsDrawer
        visible={tagsDrawerVisible}
        onClose={() => setTagsDrawerVisible(false)}
        tags={tags}
        videos={videos}
        selectedTagIds={drawerSelection}
        onChangeSelectedTagIds={setDrawerSelection}
        onCreateTag={() => {
          setTagsDrawerVisible(false);
          router.push("/tag-editor");
        }}
        onEditTag={(tagId) => {
          setTagsDrawerVisible(false);
          router.push(`/tag-editor?tagId=${tagId}`);
        }}
        onReparentTag={(tagId) => {
          setTagsDrawerVisible(false);
          router.push(`/tag-reparent?tagId=${tagId}`);
        }}
        onDeleteTag={(tagId, mode) => removeTag(tagId, mode)}
        onBulkReparentTags={(tagIds) => {
          setTagsDrawerVisible(false);
          router.push(`/tag-reparent?tagIds=${tagIds.join(",")}`);
        }}
        initialMode="edit"
        confirmLabel="Готово"
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const S = useSoft();
  return (
    <View style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow }]}>
      <Text style={[TYPE.meta, { color: S.ink2, marginBottom: 10 }]}>{title}</Text>
      {children}
    </View>
  );
}

function Segmented<T extends string>({ options, value, onChange }: { options: { key: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pill key={o.key} flex label={o.label} selected={o.key === value} onPress={() => onChange(o.key)} style={{ paddingHorizontal: 6 }} />
      ))}
    </View>
  );
}

function ListRow({ icon, label, count, onPress }: { icon: string; label: string; count?: number; onPress: () => void }) {
  const S = useSoft();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.listRow, { backgroundColor: pressed ? S.fill : "transparent" }]}>
      <Ionicons name={icon as any} size={20} color={S.ink2} />
      <Text style={[TYPE.row, { flex: 1, color: S.ink }]}>{label}</Text>
      {count !== undefined ? <Text style={[TYPE.meta, { color: S.ink3 }]}>{count}</Text> : <Ionicons name="chevron-forward" size={17} color={S.ink3} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { marginHorizontal: SIDE, borderRadius: RADIUS.card, padding: 16 },
  accountRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  signOut: { height: 36, borderRadius: 18, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  signIn: { flexDirection: "row", alignItems: "center", gap: 12, height: 44 },
  segmented: { flexDirection: "row", gap: 8 },
  listRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, borderRadius: 18, paddingHorizontal: 12 },
});
