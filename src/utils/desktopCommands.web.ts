// Commands from the macOS menu bar.
//
// ⌘N has to do what the "+" on the documents list does, not something
// that merely looks like it. A note made there joins the folder you are
// standing in and the project you have filtered to; a second
// implementation would create one at the root, where it would vanish
// from the list the moment it appeared - a bug that screen's own code
// carries a comment about, from the time it happened.
//
// So the menu does not DO anything. It says what was asked for, and
// whichever screen owns that verb answers. The shell dispatches a plain
// window event (no preload, no bridge - the page is served from
// localhost and this is one CustomEvent), and this is the door on the
// other side.

export type DesktopCommand = 'new-note' | 'search' | 'settings';

const EVENT = 'mindeva:command';

export function onDesktopCommand(name: DesktopCommand, handler: () => void): () => void {
  const listener = (event: Event) => {
    if ((event as CustomEvent<DesktopCommand>).detail === name) handler();
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
