import { create } from "zustand";

// THE ONE PLAYER of the whole app. `mode`: "full" = big, over the screen;
// "mini" = the capsule at the top, the video keeps playing while the
// user walks the app. `pip` = the system's small window is showing.
// Not persisted: closing the app closes the player.
interface PlayerState {
  url: string | null;
  title: string;
  mode: "full" | "mini";
  pip: boolean;
  open: (url: string, title: string) => void;
  minimize: () => void;
  expand: () => void;
  close: () => void;
  setPip: (pip: boolean) => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  url: null,
  title: "",
  mode: "full",
  pip: false,
  open: (url, title) => set({ url, title, mode: "full" }),
  minimize: () => set({ mode: "mini" }),
  expand: () => set({ mode: "full" }),
  close: () => set({ url: null, title: "", mode: "full" }),
  setPip: (pip) => set({ pip }),
}));
