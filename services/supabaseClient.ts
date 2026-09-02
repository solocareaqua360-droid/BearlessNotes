import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

/**
 * The publishable (formerly "anon") key is meant to ship inside the client
 * bundle — it identifies the project, not a user. Access to actual rows is
 * scoped per-user by the Row Level Security policies on each table (see
 * supabase/migrations/0001_init.sql), not by keeping this key secret.
 */
const SUPABASE_URL = "https://vijigyjvhjluimdywdtm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fZ7im9D_7bIZA40-YQluoA_8WHq1QM3";

// expo-router's static web export pre-renders every route in Node, where
// `window` (and so AsyncStorage's web implementation) doesn't exist. Fall
// back to a no-op storage there instead of crashing the export.
const isServer = typeof window === "undefined";
const serverStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: isServer ? serverStorage : AsyncStorage,
    autoRefreshToken: !isServer,
    persistSession: !isServer,
    detectSessionInUrl: false,
  },
});
