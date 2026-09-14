import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { clearDriveToken, getDriveToken } from './utils/driveToken.web';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
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
// and told WHICH kind - a single-tab manager because two tabs sharing one
// cache is a synchronisation problem nobody here has asked for yet.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
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
// ONE window, doing both jobs - which is how the phone has always worked
// and how this should have worked from the start. Signing in and
// connecting Drive were two separate buttons here, on one account, for a
// reason no user should ever have to care about: Firebase's own popup
// issues tokens for the FIREBASE project, and `drive.file` only ever
// shows the files the project that created them asks for. Right account,
// wrong project, empty Drive.
//
// So the order is turned around. Google Identity Services asks once, as
// the DRIVE project's client and for `email profile` alongside the Drive
// scope, and the token that comes back does both: it opens Drive, and
// Firebase accepts it as proof of who this is - that client id is
// safelisted in Authentication → Google → "Safelist client IDs from
// external projects", which is the same arrangement that lets the phone
// sign in with it.
//
// The popup stays as a fallback, and deliberately. This path has more
// moving parts than the one it replaces; if any of them is not in place,
// the answer must be a working sign-in, not a dead button.
export async function signInWithGoogleAccount(): Promise<GoogleSignInResult> {
  const accessToken = await getDriveToken(true).catch(() => null);
  if (accessToken) {
    try {
      const result = await signInWithCredential(
        auth,
        GoogleAuthProvider.credential(null, accessToken)
      );
      return { uid: result.user.uid, email: result.user.email, hadToSwitch: false };
    } catch {
      // Whatever this token is, Firebase will not take it. It may still
      // be a perfectly good Drive token, but it now belongs to an account
      // that is about to be replaced by whoever the popup returns.
      clearDriveToken();
    }
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
  return { uid: credential.user.uid, email: credential.user.email, hadToSwitch: false };
}

export async function signOutEverywhere(): Promise<void> {
  // The Drive token goes with it. One window granted both, so one act
  // takes both back - a token outliving the session that asked for it
  // would mean the boards say one person and the pictures come from
  // another.
  clearDriveToken();
  await signOut(auth);
}
