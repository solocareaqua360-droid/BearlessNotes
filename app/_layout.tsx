import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from "@expo-google-fonts/inter";
import { router, SplashScreen, Stack } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AskHost, notify } from "@/components/ui/Ask";
import { PlayerHost } from "@/components/PlayerHost";
import { HoldMenuHost } from "@/components/ui/HoldMenu";
import { GlassPortalHost, GlassProvider, GlassTarget } from "@/components/ui/Glass";
import { useSoft } from "@/theme/soft";
import { extractUrl } from "@/utils/shareLink";
import { errorMessage } from "@/services/errorMessage";
import { supabase } from "@/services/supabaseClient";
import { pullRemoteIntoLocal, startAutoSync, stopAutoSync } from "@/services/sync";
import { useLibraryStore } from "@/store/useLibraryStore";

function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  useEffect(() => {
    if (!hasShareIntent) return;
    // YouTube/TikTok share "title + link", not the bare link.
    const raw = shareIntent.webUrl ?? shareIntent.text ?? "";
    const sharedUrl = extractUrl(raw) ?? raw.trim();
    if (sharedUrl) {
      router.push({ pathname: "/add-video", params: { sharedUrl } });
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
            notify("Синхронізація не вдалася", errorMessage(e));
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

SplashScreen.preventAutoHideAsync().catch(() => {});

function Shell() {
  const S = useSoft();
  return (
    <GlassProvider>
      <StatusBar style={S.dark ? "light" : "dark"} />
      <GlassTarget>
        <ShareIntentHandler />
        <AuthBootstrap />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: S.bg },
            animation: "fade",
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="auth-callback" />
          <Stack.Screen name="add-video" options={{ presentation: "transparentModal", contentStyle: { backgroundColor: "transparent" } }} />
          <Stack.Screen name="settings" />
          <Stack.Screen name="watch" />
          <Stack.Screen name="continue" />
          <Stack.Screen name="player-test" />
          <Stack.Screen name="tag-editor" options={{ presentation: "transparentModal", contentStyle: { backgroundColor: "transparent" } }} />
          <Stack.Screen name="tag-reparent" options={{ presentation: "transparentModal", contentStyle: { backgroundColor: "transparent" } }} />
        </Stack>
      </GlassTarget>
      <GlassPortalHost />
      <PlayerHost />
      <HoldMenuHost />
      <AskHost />
    </GlassProvider>
  );
}

export default function RootLayout() {
  // The app is upright; only the player's big video may turn (PlayerHost).
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);
  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <ShareIntentProvider>
          <SafeAreaProvider>
            <Shell />
          </SafeAreaProvider>
        </ShareIntentProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
