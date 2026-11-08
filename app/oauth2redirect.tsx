import { router } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

// GOOGLE SENDS THE USER BACK here (com.bearlessnotes.app:/oauth2redirect?code=...) after the
// sign-in. The sign-in code reads the answer from the link itself; this page only has to exist,
// so the router does not show «Unmatched Route», and step aside at once.
export default function OAuthRedirect() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, []);
  return <View style={{ flex: 1 }} />;
}
