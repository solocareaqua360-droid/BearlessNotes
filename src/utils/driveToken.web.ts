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
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
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
    client.requestAccessToken(interactive ? {} : { prompt: 'none' });
  });
}
