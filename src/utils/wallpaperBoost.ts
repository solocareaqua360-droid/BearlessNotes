// While a screen beside the desks (the calendar, the databases) is out,
// the wallpaper's blur grows - option Б agreed 2026-10-02: under the
// phone's wallpaper the layer no longer blurs and dims the desk itself
// (its blur cannot see the wallpaper, and the dims stacked), it hides the
// desk and the WINDOW's blur deepens instead. SideLayer says when;
// WallpaperBlur listens.
type Listener = (boosted: boolean) => void;

const holders = new Set<string>();
const listeners = new Set<Listener>();

export function setWallpaperBoost(holder: string, on: boolean) {
  const before = holders.size > 0;
  if (on) holders.add(holder);
  else holders.delete(holder);
  const after = holders.size > 0;
  if (before !== after) listeners.forEach((l) => l(after));
}

export function listenWallpaperBoost(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function wallpaperBoosted(): boolean {
  return holders.size > 0;
}
