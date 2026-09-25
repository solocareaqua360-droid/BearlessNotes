import * as QueryParams from "expo-auth-session/build/QueryParams";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { errorMessage } from "./errorMessage";
import { supabase } from "./supabaseClient";

WebBrowser.maybeCompleteAuthSession();

// A release APK has no attached console — an Alert is the only diagnostic
// channel available, so every step below labels which call actually failed
// instead of surfacing a bare, unlabeled "{message: ...}".
async function createSessionFromUrl(url: string) {
  let params: Record<string, string>;
  try {
    const parsed = QueryParams.getQueryParams(url);
    if (parsed.errorCode) throw new Error(parsed.errorCode);
    params = parsed.params;
  } catch (e) {
    throw new Error(`[getQueryParams] ${errorMessage(e)}`);
  }

  const { access_token, refresh_token } = params;
  if (!access_token || !refresh_token) return null;

  try {
    const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return data.session;
  } catch (e) {
    throw new Error(`[setSession] ${errorMessage(e)}`);
  }
}

export async function signInWithGoogle() {
  // Computed at call time (not module load): in Expo Go this is an exp://
  // URL, not the app's own "bearlessnotes://" scheme — Supabase's Redirect
  // URLs allowlist must include it (e.g. "exp://**") or it silently refuses
  // to redirect back after Google auth completes.
  const redirectTo = Linking.createURL("auth-callback");

  let authorizeUrl: string;
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data?.url) throw new Error("Supabase не повернув посилання для входу");
    authorizeUrl = data.url;
  } catch (e) {
    throw new Error(`[signInWithOAuth] ${errorMessage(e)}`);
  }

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectTo);
  } catch (e) {
    throw new Error(`[openAuthSessionAsync] ${errorMessage(e)}`);
  }

  // A cancel/dismiss here is a normal outcome, not a failure: on Android the
  // OAuth redirect can also land directly on app/auth-callback.tsx, which
  // completes the session itself while this browser session just closes.
  if (result.type !== "success" || !result.url) return null;

  return createSessionFromUrl(result.url);
}

export async function signOutOfSupabase() {
  await supabase.auth.signOut();
}
