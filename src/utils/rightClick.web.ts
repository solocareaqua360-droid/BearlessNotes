// See rightClick.ts. The handler is hung on the DOM node itself through a
// ref, not through an `onContextMenu` prop: Pressable builds its own
// onContextMenu (to swallow the menu after a touch long-press) and it
// overrides one passed in. Assigning `oncontextmenu` replaces the previous
// handler every render, so nothing piles up. The browser's own menu
// ("Reload / Save as") is never what was wanted on a card, so it is kept
// from opening.
export function bindRightClick(node: unknown, handler?: (() => void) | undefined): void {
  const el = node as { oncontextmenu: ((e: Event) => void) | null } | null;
  if (!el || !handler) return;
  el.oncontextmenu = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    handler();
  };
}

export function rightClick(handler?: (() => void) | undefined): object {
  if (!handler) return {};
  return { ref: (node: unknown) => bindRightClick(node, handler) };
}
