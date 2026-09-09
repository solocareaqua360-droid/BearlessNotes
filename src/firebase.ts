import { getFirestore } from '@react-native-firebase/firestore';
import { getAuth, onAuthStateChanged, signInAnonymously } from '@react-native-firebase/auth';

// The native Firebase SDK reads its config from google-services.json (wired
// via app.json's android.googleServicesFile), not from JS - so there's no
// config object here. Disk persistence is on by default: a cold start renders
// from the on-device cache immediately, and writes made offline are queued on
// disk and survive an app restart.
export const db = getFirestore();

export const auth = getAuth();

// This app has no login screen and never will for its current single-user,
// one-shared-database model (see CLAUDE.md) - anonymous auth exists purely
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
