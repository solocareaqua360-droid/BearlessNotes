import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";

import { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_REDIRECT_URI, GOOGLE_SCOPES } from "@/constants/google";
import { useGoogleStore } from "@/store/useGoogleStore";

WebBrowser.maybeCompleteAuthSession();

const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

export function isSignedIn(): boolean {
  return !!useGoogleStore.getState().refreshToken;
}

/**
 * Signs in: Google's own page opens in the browser, the user picks the account
 * and agrees to READ the subscriptions, Google sends the user back with a code,
 * which is exchanged (PKCE, no secret) for the tokens. Returns false if the
 * user backed out.
 */
export async function signInWithGoogle(): Promise<boolean> {
  const request = new AuthSession.AuthRequest({
    clientId: GOOGLE_ANDROID_CLIENT_ID,
    redirectUri: GOOGLE_REDIRECT_URI,
    scopes: GOOGLE_SCOPES,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    // «offline» + «consent»: Google hands out a refresh token, so the sign-in lasts.
    extraParams: { access_type: "offline", prompt: "consent" },
  });
  const result = await request.promptAsync(DISCOVERY);
  if (result.type !== "success") return false;
  const code = result.params.code;
  if (!code) throw new Error("Google не повернув код входу");
  const tokens = await AuthSession.exchangeCodeAsync(
    {
      clientId: GOOGLE_ANDROID_CLIENT_ID,
      code,
      redirectUri: GOOGLE_REDIRECT_URI,
      extraParams: { code_verifier: request.codeVerifier ?? "" },
    },
    DISCOVERY
  );
  useGoogleStore.getState().set({
    idToken: tokens.idToken ?? null,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? useGoogleStore.getState().refreshToken,
    expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000 - 60000,
  });
  return true;
}

export async function signOutOfGoogle(): Promise<void> {
  const { refreshToken, signOut } = useGoogleStore.getState();
  signOut();
  if (refreshToken) {
    // Tell Google too; failing to is harmless.
    fetch(`${DISCOVERY.revocationEndpoint}?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }).catch(() => {});
  }
}

/** A working access token, refreshed when it ran out; null when not signed in. */
export async function getAccessToken(): Promise<string | null> {
  const s = useGoogleStore.getState();
  if (!s.refreshToken) return null;
  if (s.accessToken && Date.now() < s.expiresAt) return s.accessToken;
  const res = await fetch(DISCOVERY.tokenEndpoint!, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${encodeURIComponent(GOOGLE_ANDROID_CLIENT_ID)}&grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refreshToken)}`,
  });
  if (!res.ok) {
    // Revoked, or the 7-day «Testing» limit ran out: sign in again.
    if (res.status === 400 || res.status === 401) s.signOut();
    return null;
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number; id_token?: string };
  s.set({ accessToken: data.access_token, idToken: data.id_token ?? s.idToken, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60000 });
  return data.access_token;
}

/**
 * Who this Google account is, for the cloud: a fresh id token (null when the sign-in was made
 * before «openid» was asked - then the user has to sign in once more).
 */
export async function getGoogleIdentity(): Promise<{ idToken: string | null; accessToken: string | null }> {
  const s0 = useGoogleStore.getState();
  if (!s0.refreshToken) return { idToken: null, accessToken: null };
  const res = await fetch(DISCOVERY.tokenEndpoint!, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${encodeURIComponent(GOOGLE_ANDROID_CLIENT_ID)}&grant_type=refresh_token&refresh_token=${encodeURIComponent(s0.refreshToken)}`,
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) s0.signOut();
    return { idToken: null, accessToken: null };
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number; id_token?: string };
  s0.set({ accessToken: data.access_token, idToken: data.id_token ?? s0.idToken, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60000 });
  return { idToken: data.id_token ?? null, accessToken: data.access_token };
}
