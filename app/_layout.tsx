import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "@/constants/theme";

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

export default function RootLayout() {
  return (
    <ShareIntentProvider>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <ShareIntentHandler />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="index" />
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
