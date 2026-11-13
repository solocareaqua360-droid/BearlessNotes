import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// THE BOOKKEEPING of the cloud sync (the data itself lives in the other stores).
// `known` remembers, for every synced thing, what it looked like the last time
// this phone and the cloud agreed (a short fingerprint `h`) and when it last
// changed (`t`, ms, newer wins). A thing whose fingerprint differs from `known`
// has changed here and is waiting to be sent; `p` marks exactly that.
export type Known = { h: string; t: number; p?: boolean; del?: boolean };

interface SyncState {
  /** Firebase session of this phone (from the Google sign-in). */
  uid: string | null;
  email: string | null;
  fbRefresh: string | null;
  fbToken: string | null;
  fbExpiresAt: number;
  known: Record<string, Known>;
  /** The newest cloud change (server time) this phone has already taken. */
  cursor: string | null;
  lastSyncAt: number;
  /** "idle" | "working" | "error" */
  status: "idle" | "working" | "error";
  error: string | null;
  set: (patch: Partial<Omit<SyncState, "set" | "reset">>) => void;
  reset: () => void;
}

const EMPTY = {
  uid: null,
  email: null,
  fbRefresh: null,
  fbToken: null,
  fbExpiresAt: 0,
  known: {} as Record<string, Known>,
  cursor: null as string | null,
  lastSyncAt: 0,
  status: "idle" as const,
  error: null as string | null,
};

export const useSyncStore = create<SyncState>()(
  persist(
    (set) => ({
      ...EMPTY,
      set: (patch) => set(patch),
      reset: () => set({ ...EMPTY }),
    }),
    {
      name: "cinema-sync",
      storage: createJSONStorage(() => AsyncStorage),
      // A half-finished «working» must not survive a restart.
      partialize: (s) => ({
        uid: s.uid,
        email: s.email,
        fbRefresh: s.fbRefresh,
        fbToken: s.fbToken,
        fbExpiresAt: s.fbExpiresAt,
        known: s.known,
        cursor: s.cursor,
        lastSyncAt: s.lastSyncAt,
      }),
    }
  )
);
