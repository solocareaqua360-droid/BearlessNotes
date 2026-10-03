// OPENING A DESK THAT MAY HAVE BEEN CLOSED. Every desk can be closed now,
// the documents too, and screens all over the app send the user to
// «Документи» by name. A route that is not there goes nowhere, so a closed
// desk is opened again first (the documents right after the start desk,
// any other at the end) and then navigated to.
//
// Its own file with no imports: constants/databaseTiles needs it, and
// desks.tsx imports THAT - one more import there would be a cycle. The
// two keys are written out for the same reason (see desks.tsx).
const START = 'Старт';
const DOCUMENTS = 'Документи';

type Control = { desks: string[]; setDesks: (next: string[]) => void };
let registered: Control | null = null;

// Told by Tabs, which owns the desks; nothing on the web, which has none.
export function registerDesks(control: Control | null) {
  registered = control;
}

// Puts the desk back if it was closed; true when it had to.
export function ensureDesk(key: string): boolean {
  const control = registered;
  if (!control || control.desks.includes(key) || key === START) return false;
  const rest = control.desks.filter((k) => k !== START);
  control.setDesks(key === DOCUMENTS ? [DOCUMENTS, ...rest] : [...rest, key]);
  return true;
}

// Calls `go` once the desk is there - at once when it already is.
export function whenDeskIsThere(key: string, go: () => void) {
  if (ensureDesk(key)) setTimeout(go, 120);
  else go();
}
