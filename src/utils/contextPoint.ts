// WHERE THE RIGHT BUTTON WAS PRESSED, for the moment right after it. A
// question the app asks straight out of a right click (its menu) belongs
// beside the pointer, a small window at the cursor, the way a Mac's own
// context menu stands - not a card in the middle of the window, which is
// what the same question is on a phone. The ask() call itself knows nothing
// of a pointer; it asks this, and gets a point only if the click was just
// now (so a confirmation that comes seconds later, after a choice, is
// not mistaken for one).
export type ContextPoint = { x: number; y: number };

let last: (ContextPoint & { at: number }) | null = null;

export function markContextPoint(x: number, y: number): void {
  last = { x, y, at: Date.now() };
}

// Handed out once: the first question after the click takes it.
export function takeRecentContextPoint(): ContextPoint | null {
  if (!last || Date.now() - last.at > 700) return null;
  const point = { x: last.x, y: last.y };
  last = null;
  return point;
}
