import { getFirestore } from '@react-native-firebase/firestore';
import {
  GoogleAuthProvider,
  getAuth,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signOut,
} from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

// The native Firebase SDK reads its config from google-services.json (wired
// via app.json's android.googleServicesFile), not from JS - so there's no
// config object here. Disk persistence is on by default: a cold start renders
// from the on-device cache immediately, and writes made offline are queued on
// disk and survive an app restart.
export const db = getFirestore();

export const auth = getAuth();

// Anonymous auth is how a device gets an identity before anyone signs in -
// so the Firestore rules can require request.auth != null instead of being
// open to anyone who extracts the (necessarily public, baked into the APK)
// project config. The native SDK persists the resulting session to disk on
// its own, so this only touches the network on a device's very first-ever
// launch - every later cold start (even offline) already has a signed-in
// user by the time onAuthStateChanged first fires.
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

// Signing in with Google, without orphaning what is already here.
//
// The device is already signed in ANONYMOUSLY by the time anyone taps this,
// and that anonymous user may own data. LINKING the Google credential to it
// keeps the same uid, so nothing has to be moved - the account simply gains
// a real identity.
//
// Linking fails when this Google account has signed in on some other device
// before: its uid already exists, and one credential cannot belong to two.
// Then the only correct move is to sign in AS that account - and whatever
// this device's anonymous user owned stays behind under a uid nobody can
// reach again. Which is exactly why claiming ownership has to happen after
// this, never before: until there is one identity across devices, there is
// no right uid to stamp on anything.
export type GoogleSignInResult = { uid: string; email: string | null; hadToSwitch: boolean };

export async function signInWithGoogleAccount(): Promise<GoogleSignInResult> {
  await GoogleSignin.hasPlayServices();
  const response = await GoogleSignin.signIn();
  const idToken = response.data?.idToken;
  if (!idToken) throw new Error('Google не повернув токен');
  const credential = GoogleAuthProvider.credential(idToken);

  const current = auth.currentUser;
  if (current?.isAnonymous) {
    try {
      const linked = await linkWithCredential(current, credential);
      return { uid: linked.user.uid, email: linked.user.email, hadToSwitch: false };
    } catch (error) {
      const code = (error as { code?: string }).code;
      // Anything else is a real failure and should surface, not be papered
      // over by silently switching accounts.
      if (code !== 'auth/credential-already-in-use' && code !== 'auth/email-already-in-use') throw error;
    }
  }
  const signedIn = await signInWithCredential(auth, credential);
  return { uid: signedIn.user.uid, email: signedIn.user.email, hadToSwitch: !!current?.isAnonymous };
}

export async function signOutEverywhere(): Promise<void> {
  await GoogleSignin.signOut().catch(() => {});
  await signOut(auth);
}
