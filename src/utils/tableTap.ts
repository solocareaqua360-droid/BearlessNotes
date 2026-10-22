// Where the finger landed on a LOCKED table, handed to the table that is about to wake up.
//
// A table in a note is inert until it is the active block (a swipe over it scrolls the page), and the first tap only activates it. By then the
// table is a different component instance - the locked one sits inside a Pressable, the live one does not - so it cannot know which cell was
// meant, and while it mounted the keyboard's old owner lost its focus to the FIRST field on the page (the folder box under the title): the user's
// «курсор зіскакує на поле папки». The tap is written here before the block is activated and read once, by the live table, which selects that
// cell and takes the focus itself.
export type TableTap = { blockId: string; x: number; y: number; width: number; height: number };

let pending: TableTap | null = null;

export function rememberTableTap(tap: TableTap) {
  pending = tap;
}

export function takeTableTap(blockId: string): TableTap | null {
  if (!pending || pending.blockId !== blockId) return null;
  const tap = pending;
  pending = null;
  return tap;
}

// A table that is only SELECTED (first tap: a frame and the dots, no keyboard, no typing) has no keyboard whose lowering would hand the block back,
// so nothing ever deactivated it - the user: «треба тапнути на інше поле, інакше таргетка не збивається» (2026-10-22). It registers here while
// it is in that state; the note's scroll area looks at every touch, and one that does not begin inside the table releases the block.
let holder: string | null = null;
let insideStamp = -1;

export function holdTable(blockId: string | null) {
  holder = blockId;
}
export function heldTable(): string | null {
  return holder;
}
export function markTouchInsideTable(timestamp: number) {
  insideStamp = timestamp;
}
export function touchWasInsideTable(timestamp: number): boolean {
  return insideStamp === timestamp;
}

// While a table's menu is open the keyboard is put away (the user, 2026-10-22: «клавіатура лише заважає»), and putting it away must not end
// the editing session - the menu lives in the table's editing face, which exists only while the block is the active one.
let menuOpenFlag = false;
export function setTableMenuOpen(open: boolean) {
  menuOpenFlag = open;
}
export function tableMenuIsOpen(): boolean {
  return menuOpenFlag;
}
