import type { ThoughtSource } from '../hooks/useThoughts';

// Opening the thought windows from anywhere (the share sheet, the living folder in the explorer): one host, mounted
// once at the app's root (ThoughtsHost), listens here.
export type CaptureRequest = {
  source?: ThoughtSource;
  // Pictures it arrives with (local addresses): a thought can come through an image alone.
  images?: string[];
  // From the share sheet: the old «куди зберегти?» stays one tap away (the user's rule of gradual migration).
  onElsewhere?: () => void;
  // Caught from a theme's canvas: «Куди?» is already answered - it lands there.
  themeId?: string;
};

type Listener = { capture?: (req: CaptureRequest) => void; space?: () => void; reader?: (id: string) => void };
let listener: Listener = {};

export function setThoughtListener(next: Listener) {
  listener = next;
  return () => {
    if (listener === next) listener = {};
  };
}

export function openThoughtCapture(req: CaptureRequest = {}): boolean {
  if (!listener.capture) return false;
  listener.capture(req);
  return true;
}

export function openThoughtsSpace(): boolean {
  if (!listener.space) return false;
  listener.space();
  return true;
}

// The island's «open the card»: the host opens the reader on that thought.
export function openThoughtReader(id: string): boolean {
  if (!listener.reader) return false;
  listener.reader(id);
  return true;
}

// Which thought's card is open for reading right now (the island steps aside while the card shows its own player).
let shownReader: string | null = null;
const shownListeners = new Set<(id: string | null) => void>();
export function setShownReader(id: string | null) {
  shownReader = id;
  shownListeners.forEach((l) => l(id));
}
export function subscribeShownReader(l: (id: string | null) => void) {
  shownListeners.add(l);
  l(shownReader);
  return () => {
    shownListeners.delete(l);
  };
}
export function clearShownReader(id: string) {
  if (shownReader === id) setShownReader(null);
}
