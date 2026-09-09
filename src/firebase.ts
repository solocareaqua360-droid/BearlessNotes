import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';
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

export const db = initializeFirestore(app, {});

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});
