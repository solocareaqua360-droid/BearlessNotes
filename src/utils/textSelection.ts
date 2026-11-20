// WHETHER THE PAGE HOLDS A TEXT SELECTION (2026-11-13). The Mac app's own Cmd+C / Cmd+X handlers (the explorer copies
// cards, a board copies its cards) took the keys even when the user had selected TEXT - in «Думки» the selected text
// never reached the clipboard. Any such handler asks this first and, when text is selected, leaves the key to the
// browser's own copy. Native has no window selection: always false there.
export function hasTextSelection(): boolean {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false;
  const s = window.getSelection();
  return !!s && !s.isCollapsed && s.toString().trim().length > 0;
}
