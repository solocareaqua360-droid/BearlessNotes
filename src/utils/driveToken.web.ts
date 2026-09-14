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
// Drive, and who is asking. `email profile` are here so this one window
// can do both jobs: the resulting token opens Drive AND tells Firebase
// which account granted it (see signInWithGoogleAccount in
// firebase.web). Without them the token is anonymous as far as identity
// goes, and signing in would need a second window of its own - which is
// exactly the arrangement this replaces.
const DRIVE_SCOPE = 'email profile https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

type TokenClient = { requestAccessToken: (options?: { prompt?: string }) => void };

let token: string | null = null;
let expiresAt = 0;
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
export async function getDriveToken(interactive: boolean): Promise<string | null> {
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
      callback: (response: { access_token?: string; expires_in?: number }) => {
        if (response.access_token) {
          token = response.access_token;
          // A minute short of the real expiry, so a request never goes
          // out with a token that dies on the way.
          expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000 - 60_000;
          listeners.forEach((l) => l());
        }
        finish(token);
      },
      error_callback: () => finish(null),
    });
    // Nothing came back at all - a silent attempt with no grant yet
    // simply never calls back, and waiting for ever would freeze whatever
    // asked.
    if (!interactive) setTimeout(() => finish(null), 3000);
    // 'select_account' rather than the default, for the same reason the
    // Firebase popup now asks: on a machine signed into two Google
    // accounts, the default quietly picks one, and picking the wrong one
    // here shows an empty Drive rather than an error.
    client.requestAccessToken(interactive ? { prompt: 'select_account' } : { prompt: 'none' });
  });
}
