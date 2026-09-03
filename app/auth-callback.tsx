import * as QueryParams from "expo-auth-session/build/QueryParams";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";

import { colors } from "@/constants/theme";
import { initialSyncAfterSignIn, startAutoSync } from "@/services/sync";
import { supabase } from "@/services/supabaseClient";
import { useLibraryStore } from "@/store/useLibraryStore";

/**
 * Expo Router treats any incoming link matching the app's scheme as a route
 * — including the Supabase OAuth redirect — so without a real screen here it
 * showed "Unmatched Route" and the session tokens in the URL were dropped.
 * This screen finishes the sign-in itself, as a reliable fallback alongside
 * (not instead of) services/auth.ts's own WebBrowser-based flow.
 */
export default function AuthCallbackScreen() {
  const updateSettings = useLibraryStore((s) => s.updateSettings);
  const url = Linking.useURL();
  const handled = useRef(false);

  useEffect(() => {
    if (!url || handled.current) return;
    handled.current = true;

    (async () => {
      try {
        const { params, errorCode } = QueryParams.getQueryParams(url);
        if (errorCode) throw new Error(errorCode);

        const { access_token, refresh_token } = params;
        if (access_token && refresh_token) {
          const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;

          const session = data.session;
          if (session) {
            updateSettings({
              account: {
                email: session.user.email ?? "",
                avatarUrl: session.user.user_metadata?.avatar_url ?? null,
              },
            });
            await initialSyncAfterSignIn(session.user.id);
            startAutoSync(session.user.id);
          }
        }
      } catch (e) {
        Alert.alert("Вхід не вдався", e instanceof Error ? e.message : String(e));
      } finally {
        router.replace("/settings");
      }
    })();
  }, [url, updateSettings]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.iconDark} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});
