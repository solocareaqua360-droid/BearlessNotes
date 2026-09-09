import { getFirestore } from '@react-native-firebase/firestore';

// The native Firebase SDK reads its config from google-services.json (wired
// via app.json's android.googleServicesFile), not from JS - so there's no
// config object here. Disk persistence is on by default: a cold start renders
// from the on-device cache immediately, and writes made offline are queued on
// disk and survive an app restart.
export const db = getFirestore();
