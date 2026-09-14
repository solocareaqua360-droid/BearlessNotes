// Getting a Drive token in a browser, from the SAME project the phone
// uses - which is the whole reason this is not Firebase's own sign-in.
//
// `drive.file` grants access to the files a project created. The phone
// signs in as the "mindEva sign-in" client in the Drive project, so its
// backups belong to that project; ask Google as anybody else and every
// file already up there is invisible. Firebase's popup issues tokens for
// the FIREBASE project, so it cannot be used for this - hence Google
// Identity Services here, with the same client id the phone carries.
//
// A client id is public by design; it is in every APK already.

import { GOOGLE_CLIENT_ID } from '../constants/googleClient';

const CLIENT_ID = GOOGLE_CLIENT_ID;
// Drive, and nothing else.
//
// `email profile` were here for a while, so that one window could both
// open Drive and prove to Firebase who was asking. Firebase would not
// take that token, so the second window came back anyway - and the wider
// scope did real harm on its way out: a Google consent is granted for a
// SET of permissions, so asking for a bigger set invalidates the grant
// already given. The silent refresh then failed on every load and the
// "Підключити Диск" bar returned each time, looking like a new bug.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

type TokenClient = { requestAccessToken: (options?: { prompt?: string }) => void };

let token: string | null = null;
let expiresAt = 0;
// Why the last attempt failed, kept so the bar can say it. Google's
// answers here are short and useful ("access_denied", "popup_closed",
// and the silent attempt's own quiet nothing) and every one of them was
// being thrown away, which is why a failure looked identical to never
// having tried.
let lastError: string | null = null;
let client: TokenClient | null = null;
const listeners = new Set<() => void>();

export function subscribeToDriveToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasDriveToken(): boolean {
  return !!token && Date.now() < expiresAt;
}

// A token belongs to the account that granted it. Change accounts and
// keeping it would mean the boards say one person and the pictures come
// from another - so switching signs this out too, and the next "Підключити
// Диск" asks again as whoever is signed in now.
export function driveTokenError(): string | null {
  return lastError;
}

export function clearDriveToken(): void {
  token = null;
  expiresAt = 0;
  listeners.forEach((l) => l());
}

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Не вдалося завантажити вхід Google'));
    document.head.appendChild(script);
  });
}

// `interactive` decides whether Google may show a window. Silent first,
// every time: once the account has granted this scope, the token comes
// back without anything appearing on screen. Only the first time - and
// only from a real click, because a browser blocks a popup that no one
// asked for - does it need the window.
export async function getDriveToken(interactive: boolean, hint?: string | null): Promise<string | null> {
  if (hasDriveToken()) return token;
  await loadGis();
  const google = (window as unknown as { google?: { accounts: { oauth2: { initTokenClient: (c: unknown) => TokenClient } } } })
    .google;
  if (!google) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: DRIVE_SCOPE,
      // WHICH account, said out loud. The token itself lives only in this
      // page's memory, so every reload has to ask for it again - silently,
      // which works only while Google can tell which account is meant. On
      // a browser signed into two of them it cannot, so the silent attempt
      // failed every time and the "Підключити Диск" bar came back after
      // each reload. The hint is the account already signed in here.
      ...(hint ? { hint } : {}),
      callback: (response: { access_token?: string; expires_in?: number; error?: string }) => {
        if (response.error) lastError = response.error;
        if (response.access_token) {
          lastError = null;
          token = response.access_token;
          // A minute short of the real expiry, so a request never goes
          // out with a token that dies on the way.
          expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000 - 60_000;
          listeners.forEach((l) => l());
        }
        finish(token);
      },
      error_callback: (error?: { type?: string; message?: string }) => {
        lastError = error?.message || error?.type || 'Google нічого не відповів';
        finish(null);
      },
    });
    // Nothing came back at all - a silent attempt with no grant yet
    // simply never calls back, and waiting for ever would freeze whatever
    // asked.
    if (!interactive)
      setTimeout(() => {
        // A silent attempt with no grant behind it never calls back at
        // all - no callback, no error, nothing. That silence IS the
        // answer, and saying so is the difference between "not connected"
        // and "asked and was refused".
        if (!token) lastError = lastError ?? 'Тихий запит лишився без відповіді - згоди ще немає';
        finish(null);
      }, 3000);
    // 'select_account' rather than the default, for the same reason the
    // Firebase popup now asks: on a machine signed into two Google
    // accounts, the default quietly picks one, and picking the wrong one
    // here shows an empty Drive rather than an error.
    client.requestAccessToken(interactive ? { prompt: 'select_account' } : { prompt: 'none' });
  });
}
