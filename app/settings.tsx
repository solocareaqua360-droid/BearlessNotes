import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { TagsDrawer } from "@/components/TagsDrawer";
import { colors, radius, spacing } from "@/constants/theme";
import { signInWithGoogle, signOutOfSupabase } from "@/services/auth";
import { initialSyncAfterSignIn, startAutoSync, stopAutoSync } from "@/services/sync";
import { useLibraryStore } from "@/store/useLibraryStore";
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
  const settings = useLibraryStore((s) => s.settings);
  const updateSettings = useLibraryStore((s) => s.updateSettings);
  const videos = useLibraryStore((s) => s.videos);
  const tags = useLibraryStore((s) => s.tags);
  const removeTag = useLibraryStore((s) => s.removeTag);

  const [tagsDrawerVisible, setTagsDrawerVisible] = useState(false);
  const [drawerSelection, setDrawerSelection] = useState<string[]>([]);
  const [signingIn, setSigningIn] = useState(false);

  const unsortedCount = videos.filter((v) => v.tagIds.length === 0).length;

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      const session = await signInWithGoogle();
      if (!session) return;

      updateSettings({
        account: {
          email: session.user.email ?? "",
          avatarUrl: session.user.user_metadata?.avatar_url ?? null,
        },
      });
      await initialSyncAfterSignIn(session.user.id);
      startAutoSync(session.user.id);
    } catch (e) {
      Alert.alert("Не вдалося увійти", e instanceof Error ? e.message : "Спробуйте ще раз");
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    stopAutoSync();
    updateSettings({ account: null, lastSyncedAt: null });
    try {
      await signOutOfSupabase();
    } catch {
      // Local sign-out already happened; the Supabase session will just expire.
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Налаштування</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.accountCard}>
          {settings.account ? (
            <>
              <View style={styles.accountIcon}>
                {settings.account.avatarUrl ? (
                  <Image source={{ uri: settings.account.avatarUrl }} style={styles.accountAvatar} />
                ) : (
                  <Ionicons name="person" size={20} color={colors.textPrimary} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.accountEmail}>{settings.account.email}</Text>
                <Text style={styles.accountSync}>
                  {settings.lastSyncedAt
                    ? `Синхронізовано: ${new Date(settings.lastSyncedAt).toLocaleString()}`
                    : "Ще не синхронізовано"}
                </Text>
              </View>
              <Pressable onPress={handleSignOut}>
                <Text style={styles.signOut}>Вийти</Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={styles.signInRow} onPress={handleSignIn} disabled={signingIn}>
              {signingIn ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <Ionicons name="logo-google" size={20} color={colors.textPrimary} />
              )}
              <Text style={styles.signInLabel}>
                {signingIn ? "Вхід…" : "Увійти через Google"}
              </Text>
            </Pressable>
          )}
        </View>

        <Section title="Тема">
          <SegmentedControl
            options={THEME_OPTIONS}
            value={settings.theme}
            onChange={(theme) => updateSettings({ theme })}
          />
        </Section>

        <Section title="Відкриття відео">
          <SegmentedControl
            options={OPEN_MODE_OPTIONS}
            value={settings.openVideoMode}
            onChange={(openVideoMode) => updateSettings({ openVideoMode })}
          />
        </Section>

        <View style={styles.listSection}>
          <Pressable style={styles.listRow} onPress={() => setTagsDrawerVisible(true)}>
            <Text style={styles.listRowLabel}>Редагувати теги</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
          <Pressable
            style={[styles.listRow, styles.listRowLast]}
            onPress={() => router.push({ pathname: "/", params: { unsorted: "1" } })}
          >
            <Text style={styles.listRowLabel}>Невідсортоване</Text>
            <Text style={styles.listRowCount}>{unsortedCount}</Text>
          </Pressable>
        </View>
      </View>

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
        initialMode="edit"
        confirmLabel="Готово"
      />
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange(option.key)}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  accountCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  accountIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  accountAvatar: {
    width: 40,
    height: 40,
  },
  accountEmail: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  accountSync: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  signOut: {
    color: colors.iconDark,
    fontSize: 13,
    fontWeight: "700",
  },
  signInRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  signInLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.pillInactive,
    borderRadius: radius.pill,
    padding: 4,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  segmentLabelActive: {
    color: colors.textPrimary,
  },
  listSection: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listRowLast: {
    borderBottomWidth: 0,
  },
  listRowLabel: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  listRowCount: {
    color: colors.textMuted,
    fontSize: 13,
  },
});
