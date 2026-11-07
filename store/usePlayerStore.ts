import { create } from "zustand";

// THE ONE PLAYER of the whole app. `mode`: "watch" = the watch screen (video
// at the top, details and the folder's other videos under it); "full" = big,
// over the screen, may turn sideways; "mini" = the strip at the top, the
// video keeps playing while the user walks the app. `pip` = the system's small
// window is showing. Not persisted: closing the app closes the player.
export type PlayerMode = "watch" | "full" | "mini";

interface OpenOptions {
  /** The library video it is (so the watch screen can be reopened from the strip). */
  videoId?: string | null;
  /** The folder it was opened from ("" / null = the root). */
  folderId?: string | null;
  mode?: PlayerMode;
}

interface PlayerState {
  url: string | null;
  title: string;
  videoId: string | null;
  folderId: string | null;
  mode: PlayerMode;
  pip: boolean;
  open: (url: string, title: string, opts?: OpenOptions) => void;
  setMode: (mode: PlayerMode) => void;
  minimize: () => void;
  /** Back from the strip: the watch screen when it is a library video, else the big player. */
  expand: () => void;
  close: () => void;
  setPip: (pip: boolean) => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  url: null,
  title: "",
  videoId: null,
  folderId: null,
  mode: "full",
  pip: false,
  open: (url, title, opts) =>
    set({
      url,
      title,
      videoId: opts?.videoId ?? null,
      folderId: opts?.folderId ?? null,
      mode: opts?.mode ?? "full",
    }),
  setMode: (mode) => set({ mode }),
  minimize: () => set({ mode: "mini" }),
  expand: () => set((s) => ({ mode: s.videoId ? "watch" : "full" })),
  close: () => set({ url: null, title: "", videoId: null, folderId: null, mode: "full" }),
  setPip: (pip) => set({ pip }),
}));
