import AsyncStorage from '@react-native-async-storage/async-storage';

// The one thing the stock-photo search needs that this app cannot ship
// with: a Pexels API key. Free, instant, no attribution required by their
// licence - but it is still an account only the user can create (an API
// key is a credential, and creating one is signing up for a service),
// so it lives here rather than baked into the build.
//
// Kept on the device, not in Firestore: it authorises HTTP requests this
// app makes, not a record about anything - nothing about it belongs on
// every other device this account is signed into.

const STORAGE_KEY = 'stockPhotos.pexelsKey';

let cached: string | null | undefined;
let loading: Promise<string | null> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeToPexelsKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function getPexelsKey(): Promise<string | null> {
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

export async function setPexelsKey(key: string | null): Promise<void> {
  cached = key || null;
  if (cached) await AsyncStorage.setItem(STORAGE_KEY, cached);
  else await AsyncStorage.removeItem(STORAGE_KEY);
  notify();
}
