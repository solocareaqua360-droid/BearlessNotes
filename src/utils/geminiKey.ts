import AsyncStorage from '@react-native-async-storage/async-storage';

// The one thing "Запитати Gemini" needs that this app cannot ship with:
// a Gemini API key. Free to create at aistudio.google.com/apikey - but,
// same as the Pexels key (see pexelsKey.ts, the template this file
// copies), it is still a credential only the user can create, so it
// lives here rather than baked into the build (see the project's
// "before publishing" memory).
//
// Kept on the device, not in Firestore, for the same reason the Pexels
// key is: it authorises HTTP requests this app makes on the user's own
// behalf, not a record about anything - nothing about it belongs on
// every other device this account is signed into.

const STORAGE_KEY = 'chat.geminiKey';

let cached: string | null | undefined;
let loading: Promise<string | null> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeToGeminiKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function getGeminiKey(): Promise<string | null> {
  if (cached !== undefined) return cached;
  if (!loading) {
    loading = AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        cached = value || null;
        return cached;
      })
      .catch(() => {
        cached = null;
        return cached;
      });
  }
  return loading;
}

export async function setGeminiKey(key: string | null): Promise<void> {
  cached = key || null;
  if (cached) await AsyncStorage.setItem(STORAGE_KEY, cached);
  else await AsyncStorage.removeItem(STORAGE_KEY);
  notify();
}
