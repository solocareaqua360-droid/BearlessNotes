import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';
// `firebase/auth` doesn't forward the React Native build in this SDK version,
// so the RN-only persistence helper has to come from the underlying package.
// Its public .d.ts doesn't list this export even though the RN build ships it
// at runtime — see https://github.com/firebase/firebase-js-sdk/issues/8153.
import { initializeAuth } from '@firebase/auth';
// @ts-expect-error - getReactNativePersistence exists at runtime but is missing from @firebase/auth's shared type declarations
import { getReactNativePersistence } from '@firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// A cold app launch used to always wait on the network - the SDK's default
// cache is memory-only, wiped on every restart, so even a document you
// just had open has to be re-fetched before anything shows. persistentLocalCache
// keeps it on disk instead, so a cold start can paint from what's already
// there while Firestore syncs quietly in the background.
//
// This web SDK's persistent cache is built on IndexedDB, which doesn't
// exist in React Native/Hermes - unverified here whether the RN build ships
// a working substitute or would throw trying to open one. initializeFirestore
// throws SYNCHRONOUSLY if the cache can't be set up, and this call is the
// first thing the whole app does - a failure here with no fallback would
// crash on every single launch, not just cost a redundant network round
// trip. Falling back to the plain in-memory default (today's already-known-
// working behavior) on any error keeps that from being a regression from
// attempting this at all.
function createFirestore() {
  try {
    return initializeFirestore(app, { localCache: persistentLocalCache() });
  } catch (error) {
    console.warn('Firestore persistent cache unavailable, falling back to memory-only:', error);
    return initializeFirestore(app, {});
  }
}

export const db = createFirestore();

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});
