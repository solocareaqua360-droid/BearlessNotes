import { router } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { colors } from "@/constants/theme";

/**
 * Expo Router treats any incoming link matching the app's scheme as a route
 * to navigate to — including the Supabase OAuth redirect — so without a
 * matching screen here it showed "Unmatched Route" instead. This screen's
 * only job is to exist so that doesn't happen; it does NOT process the
 * tokens itself. That's already done reliably by services/auth.ts's own
 * WebBrowser.openAuthSessionAsync-based flow, which receives the exact same
 * redirect through its own listener. Having this screen also parse and
 * complete the session raced the two flows against each other and could
 * leave this screen hung forever waiting on a URL that never arrived here.
 */
export default function AuthCallbackScreen() {
  useEffect(() => {
    router.replace("/settings");
  }, []);

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
