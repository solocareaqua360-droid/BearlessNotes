import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "@/constants/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
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
      </Stack>
    </SafeAreaProvider>
  );
}
