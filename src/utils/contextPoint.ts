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

// WHERE THE LEFT BUTTON WAS PRESSED, the same way: a question a click
// opens (a card in the bin: restore, or delete for good?) stands beside
// that click on a laptop, as a small menu - see AskHost. Read from every
// press on the page, so no button has to report itself. Nothing is
// listened to where there is no document (the phone).
let click: (ContextPoint & { at: number }) | null = null;

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button === 0) click = { x: event.clientX, y: event.clientY, at: Date.now() };
    },
    true
  );
}

export function takeRecentClickPoint(): ContextPoint | null {
  if (!click || Date.now() - click.at > 700) return null;
  const point = { x: click.x, y: click.y };
  click = null;
  return point;
}
