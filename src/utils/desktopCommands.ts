// Commands from the macOS menu bar. There is no menu bar on a phone, so
// nothing here does anything - see the .web sibling for the whole story.
export type DesktopCommand = 'new-note' | 'search' | 'settings';

export function onDesktopCommand(_name: DesktopCommand, _handler: () => void): () => void {
  return () => {};
}
