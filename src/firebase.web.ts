import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
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
export async function signInWithGoogleAccount(): Promise<GoogleSignInResult> {
  const provider = new GoogleAuthProvider();
  // Ask WHICH account, every time. Without this Google takes the one the
  // browser is already signed into and never shows a chooser - and on a
  // machine signed into a second Google account, that is silently the
  // wrong person. The app then works perfectly and shows an empty board
  // list, because every read is narrowed to the owner and this owner owns
  // nothing. There is no error to see anywhere: the only symptom is that
  // the data is missing.
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  return { uid: credential.user.uid, email: credential.user.email, hadToSwitch: false };
}

export async function signOutEverywhere(): Promise<void> {
  await signOut(auth);
}
