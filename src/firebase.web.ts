import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { adoptDriveToken, clearDriveToken, getDriveToken } from './utils/driveToken.web';
import { isDesktopShell, requestFromBrowser } from './utils/desktopBridge.web';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

// The browser's Firebase, beside the phone's (see firebase.ts). Metro
// picks this file for the web target on its own.
//
// The native SDK reads its config off google-services.json; the JS one
// has no such file, so it takes the same values from the environment -
// the ones .env.example has carried since the project started. They are
// public by design: a client SDK config is not a secret, it identifies
// the project rather than authorising anything. What authorises is the
// Firestore rules, and those are the thing that must be tightened before
// anyone but this account uses the app.
const app = initializeApp({
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
});

// Offline first here too, which is this app's whole promise. The native
// SDK caches to disk without being asked; the browser one has to be told,
// and told WHICH kind.
//
// A MULTI-tab manager, and the single-tab one it replaces is why the board
// list sat on a spinner for ever.
//
// A single-tab cache is not a cache that degrades when a second tab opens:
// the second tab cannot take the lease, its listeners never fire, and
// nothing says so. Just a spinner. And a second tab is not an exotic
// situation - it is what happens every time this page is opened again
// before the old one is closed, which during an afternoon of testing is
// most of the time.
//
// The note the old comment made - that two tabs sharing one cache is a
// synchronisation problem - is answered by this manager rather than
// avoided by it: it elects a primary tab and keeps the others in step.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const auth = getAuth(app);

// The browser does NOT sign in anonymously, and that is the point.
//
// On a phone an anonymous session is a reasonable identity: it is kept on
// the device, it is the same one every launch, and linking it to Google
// later keeps its uid. In a browser the same idea is a hole - the project
// config sits in the page, so anyone who opens it can call
// signInAnonymously from the console and read everything. (Demonstrated,
// not supposed: a throwaway script did exactly that.)
//
// So here there is no identity until someone signs in with the Google
// account the data belongs to, and the owner-only rules can then mean
// something.
export function ensureSignedIn(): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, () => {
      unsubscribe();
      resolve();
    });
  });
}

export type GoogleSignInResult = { uid: string; email: string | null; hadToSwitch: boolean };

// A popup rather than a redirect: a redirect loses whatever the page was
// in the middle of, and this page is a board someone may be arranging.
// Two windows, and the reason is structural rather than unfinished.
//
// This tried to be one. Google Identity Services asked as the DRIVE
// project's client for `email profile` alongside the Drive scope, and
// Firebase was to accept that token as proof of identity, the way it
// accepts the phone's. It does not: a safelisted external client is
// trusted for verifying ID TOKENS, which is what the phone hands over -
// it cannot drive the web popup. Putting that client into "Web SDK
// configuration" instead was refused outright by the Firebase console,
// three times, because that field takes a client from the Firebase
// project's own Cloud project and ours lives in another one.
//
// The alternatives are worse than the seam. Moving Drive into the
// Firebase project makes every file already backed up invisible -
// `drive.file` shows a project only what that project created. Asking
// for full Drive access instead is a restricted scope, which means a paid
// security assessment before anyone but us can use it.
//
// So: sign in, then grant. The account is chosen ONCE and carried into
// the second window as a hint, so it has nothing to ask but permission,
// and after that it is silent for ever.
export async function signInWithGoogleAccount(): Promise<GoogleSignInResult> {
  // Inside the macOS shell none of what follows is allowed to happen
  // here: Google refuses to finish a sign-in in a window an application
  // drew, and says so only after the address has been typed. So the
  // asking is done by the user's own browser and this receives the
  // answer - see desktopBridge.web for the whole reasoning.
  if (isDesktopShell()) {
    const handoff = await requestFromBrowser('signin');
    if (!handoff.idToken) throw new Error('Браузер не повернув підтвердження');
    const credential = await signInWithCredential(
      auth,
      GoogleAuthProvider.credential(handoff.idToken)
    );
    // The Drive grant travelled with it, in the same window, for the
    // same reason it does below: one trip rather than two.
    if (handoff.driveToken) adoptDriveToken(handoff.driveToken);
    return { uid: credential.user.uid, email: credential.user.email, hadToSwitch: false };
  }

  const provider = new GoogleAuthProvider();
  // Ask WHICH account. Without this Google takes the one the browser is
  // already signed into and never shows a chooser - and on a machine
  // signed into a second Google account, that is silently the wrong
  // person. The app then works perfectly and shows an empty board list,
  // because every read is narrowed to the owner and this owner owns
  // nothing. There is no error to see anywhere: the only symptom is that
  // the data is missing.
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);

  // Drive, immediately, as the account that just signed in.
  //
  // It cannot be the same window, and that is settled rather than
  // pending: Firebase's popup can only use the OAuth client of ITS own
  // Cloud project, and `drive.file` only ever shows a project the files
  // that project created. Ours were created by the phone's client, which
  // lives in a different project. Firebase refuses that client in its Web
  // SDK configuration - the field for clients from elsewhere is the
  // safelist above it, and a safelisted client verifies ID tokens; it
  // does not drive the popup.
  //
  // So this is two steps and will stay two. What it no longer is, is two
  // SIGN-INS: the account is chosen once, and `hint` carries it into the
  // second window, which then has nothing to ask but permission. After
  // that it is silent for ever - every later visit restores the token
  // with nothing on screen.
  //
  // Not awaited for the result, and failure is not an error here: a
  // browser may refuse to open a second window without a fresh click, and
  // the "Підключити Диск" bar exists for exactly that.
  getDriveToken(true, credential.user.email).catch(() => null);

  return { uid: credential.user.uid, email: credential.user.email, hadToSwitch: false };
}

// The browser half of the desktop handoff: an ordinary sign-in, in an
// ordinary browser tab, whose RESULT is handed back to the application
// rather than kept. Google's own ID token is what travels - Firebase
// will take it and issue a session of its own on the other side, which
// is what makes this a one-time trip rather than a login every launch.
export async function signInForHandoff(): Promise<{ idToken: string; email: string | null }> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.idToken) throw new Error('Google не повернув підтвердження');
  return { idToken: credential.idToken, email: result.user.email };
}

export async function signOutEverywhere(): Promise<void> {
  // The Drive token goes with it. One window granted both, so one act
  // takes both back - a token outliving the session that asked for it
  // would mean the boards say one person and the pictures come from
  // another.
  clearDriveToken();
  await signOut(auth);
}
