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

// Kept in the browser's storage for as long as Google says it is good -
// an hour - so a reload inside that hour asks for nothing. It was held in
// memory only, which meant every reload started from zero and had to
// open a window it was not allowed to open (see getDriveToken); the
// "Підключити Диск" bar came back each time and looked like a bug in
// something else.
//
// Not sensitive in the way a secret is: it is the same short-lived token
// a page already holds in memory, kept a little longer, and it dies on
// its own.
const STORAGE_KEY = 'mindeva.driveToken';

function readStored(): { token: string; expiresAt: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string; expiresAt?: number };
    if (!parsed.token || !parsed.expiresAt || Date.now() >= parsed.expiresAt) return null;
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function writeStored(value: { token: string; expiresAt: number } | null): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage refused (a private window, say) - the token still works for
    // this page's lifetime, exactly as before.
  }
}

const stored = readStored();
let token: string | null = stored?.token ?? null;
let expiresAt = stored?.expiresAt ?? 0;
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

// Whether anything has actually WANTED Drive since the token ran out.
//
// The token lasts an hour, and the bar that asks for a new one used to
// appear the moment it expired - which was right while every picture
// came down from Drive on every look. On the desktop they come off the
// disk instead, so an expired token usually means nothing at all: the
// app is complete without it, and a bar saying otherwise every hour is
// asking for a thing it does not need. So the asking waits for a real
// miss - a file that is not kept here and could not be fetched, or an
// upload that had nowhere to go.
let needed = false;

export function driveNeeded(): boolean {
  return needed;
}

export function markDriveNeeded(): void {
  if (needed) return;
  needed = true;
  listeners.forEach((l) => l());
}

// A token belongs to the account that granted it. Change accounts and
// keeping it would mean the boards say one person and the pictures come
// from another - so switching signs this out too, and the next "Підключити
// Диск" asks again as whoever is signed in now.
export function driveTokenError(): string | null {
  return lastError;
}

// A token granted somewhere else and handed to us.
//
// The desktop shell cannot ask Google for one itself: Google refuses
// OAuth to a browser embedded in an application, so the asking happens
// in the user's real browser and the answer is carried back (see
// desktopBridge.web). What arrives is the ordinary short-lived token
// this module would have obtained on its own, so it goes through the
// same door - stored, and everyone waiting for pictures told.
export function adoptDriveToken(granted: { token: string; expiresAt: number }): void {
  if (!granted.token || Date.now() >= granted.expiresAt) return;
  token = granted.token;
  expiresAt = granted.expiresAt;
  lastError = null;
  needed = false;
  writeStored({ token, expiresAt });
  listeners.forEach((l) => l());
}

// What this page holds, for handing to the shell after a grant in the
// browser. Null when there is nothing worth carrying.
export function exportDriveToken(): { token: string; expiresAt: number } | null {
  return hasDriveToken() ? { token: token as string, expiresAt } : null;
}

export function clearDriveToken(): void {
  token = null;
  expiresAt = 0;
  writeStored(null);
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

// `interactive` decides whether this may open a window - and that is the
// whole difference, because there is no third way.
//
// This used to try a "silent" request first: prompt 'none', in the hope
// that an account that had already granted the scope would answer with
// nothing on screen. It never could. Google's token client ALWAYS opens
// a popup, even to close it again at once, and a browser only allows a
// popup in answer to a click. Called on page load, from an effect, from
// an image that needed its bytes, the popup was blocked every time - and
// the error saying so was thrown away, so it looked like the grant had
// gone missing.
//
// So the non-interactive path opens nothing and asks nothing: it answers
// with the token already held (in memory, or in storage from within the
// hour) or with null. A window is opened only by the interactive path,
// which is only ever called from a click.
export async function getDriveToken(interactive: boolean, hint?: string | null): Promise<string | null> {
  if (hasDriveToken()) return token;
  if (!interactive) return null;
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
          needed = false;
          writeStored({ token, expiresAt });
          listeners.forEach((l) => l());
        }
        finish(token);
      },
      error_callback: (error?: { type?: string; message?: string }) => {
        lastError = error?.message || error?.type || 'Google нічого не відповів';
        finish(null);
      },
    });
    // With a hint the chooser has nothing to choose, so the window is only
    // the consent - and on a later visit, with the consent already given,
    // it opens and closes in the same moment. Without a hint (the "Змінити
    // акаунт" path) it asks which account, deliberately: on a machine
    // signed into two Google accounts, the default quietly picks one, and
    // picking the wrong one shows an empty Drive rather than an error.
    client.requestAccessToken(hint ? {} : { prompt: 'select_account' });
  });
}
