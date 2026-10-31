// A WINDOW OF ITS OWN for a note («У вікно», the Mac's frame B, 2026-10-19): opened at an address that says so, it
// draws the note alone - no sidebar, no composer, no right panel - the way a torn-off panel stands in Claude's
// window, and its one «‹» closes the window rather than stepping down to an explorer with nothing round it.
// Read once, before the address is cleaned (see App.web's `open` effect).
const KIND = (() => {
  try {
    const raw = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('open') : null;
    return raw ? ((JSON.parse(raw) as { kind?: string }).kind ?? null) : null;
  } catch {
    return null;
  }
})();
export const LEAN_WINDOW = KIND === 'note' || KIND === 'board';
// A board's window (2026-10-30, the user's: explorer in one window, the board in another) keeps the RIGHT PANEL -
// the board's tools and references live there - and drops the sidebar and the composer like a note's.
export const BOARD_WINDOW = KIND === 'board';
