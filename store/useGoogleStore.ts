import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// The Google sign-in of this device: the tokens that let the app read the
// user's YouTube subscriptions. Kept in the app's private storage.
interface GoogleState {
  refreshToken: string | null;
  accessToken: string | null;
  /** When the access token stops working, ms. */
  expiresAt: number;
  set: (patch: Partial<Pick<GoogleState, "refreshToken" | "accessToken" | "expiresAt">>) => void;
  signOut: () => void;
}

export const useGoogleStore = create<GoogleState>()(
  persist(
    (set) => ({
      refreshToken: null,
      accessToken: null,
      expiresAt: 0,
      set: (patch) => set(patch),
      signOut: () => set({ refreshToken: null, accessToken: null, expiresAt: 0 }),
    }),
    { name: "cinema-google", storage: createJSONStorage(() => AsyncStorage) }
  )
);
