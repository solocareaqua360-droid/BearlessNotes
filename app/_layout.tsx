import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Alert } from "react-native";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "@/constants/theme";
import { errorMessage } from "@/services/errorMessage";
import { supabase } from "@/services/supabaseClient";
import { pullRemoteIntoLocal, startAutoSync, stopAutoSync } from "@/services/sync";
import { useLibraryStore } from "@/store/useLibraryStore";

function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  useEffect(() => {
    if (!hasShareIntent) return;
    const sharedUrl = shareIntent.webUrl ?? shareIntent.text ?? "";
    if (sharedUrl.trim()) {
      router.push({ pathname: "/add-video", params: { sharedUrl: sharedUrl.trim() } });
    }
    resetShareIntent();
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  return null;
}

function AuthBootstrap() {
  const updateSettings = useLibraryStore((s) => s.updateSettings);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      if (!active || !session) return;

      updateSettings({
        account: {
          email: session.user.email ?? "",
          avatarUrl: session.user.user_metadata?.avatar_url ?? null,
        },
      });

      pullRemoteIntoLocal(session.user.id)
        .then(() => active && updateSettings({ lastSyncedAt: Date.now() }))
        .catch((e) => {
          if (active) {
            Alert.alert("Синхронізація не вдалася", errorMessage(e));
          }
        })
        .finally(() => active && startAutoSync(session.user.id));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        stopAutoSync();
        updateSettings({ account: null, lastSyncedAt: null });
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [updateSettings]);

  return null;
}

export default function RootLayout() {
  return (
    <ShareIntentProvider>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <ShareIntentHandler />
        <AuthBootstrap />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="auth-callback" />
          <Stack.Screen name="add-video" options={{ presentation: "modal" }} />
          <Stack.Screen name="video/[id]" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="tag-editor" options={{ presentation: "modal" }} />
          <Stack.Screen name="tag-reparent" options={{ presentation: "modal" }} />
        </Stack>
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}
