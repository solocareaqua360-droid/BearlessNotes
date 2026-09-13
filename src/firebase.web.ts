import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
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

// Same shape as the phone's: a device gets an identity before anyone
// signs in, so the rules can require one. The browser persists the
// session in IndexedDB by itself.
export function ensureSignedIn(): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        unsubscribe();
        resolve();
      } else {
        signInAnonymously(auth).catch(() => {});
      }
    });
  });
}

// Signing in with Google is the native module's job, and the browser
// would need a different one entirely (Google Identity Services). Not
// built yet - and nothing in the board needs it, because with no sign-in
// every device already looks at the same data. These exist so that
// anything importing them still type-checks; they are not reachable from
// the boards-only web app.
export type GoogleSignInResult = { uid: string; email: string | null; hadToSwitch: boolean };

export async function signInWithGoogleAccount(): Promise<GoogleSignInResult> {
  throw new Error('Вхід через Google у браузері ще не зроблений');
}

export async function signOutEverywhere(): Promise<void> {
  await signOut(auth);
}
