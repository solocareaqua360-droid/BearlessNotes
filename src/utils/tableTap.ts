import { useSyncExternalStore } from 'react';

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

// A table WIDER than its place scrolls sideways on its own, locked or not, and then the left swipe that picks the whole block cannot be taken from
// anywhere on it (both go the same way): the picking swipe starts on the table's left strip (SortableBlockRow), the rest is the table's own
// scroll. The table reports here whether it is wide; the row that holds it listens. A narrow table gives nothing away - it has no scroll to share.
// The same block can stand on screen more than once (the note itself, a preview of it), each copy measuring its own place: a copy that has not
// been laid out yet must not take away what another one found. So it is kept per COPY, and a block is wide while any copy says so.
const wide = new Map<string, Set<string>>();
const wideListeners = new Set<() => void>();
export function setTableWide(blockId: string, copyId: string, isWide: boolean) {
  const copies = wide.get(blockId) ?? new Set<string>();
  if (copies.has(copyId) === isWide) return;
  if (isWide) copies.add(copyId);
  else copies.delete(copyId);
  if (copies.size > 0) wide.set(blockId, copies);
  else wide.delete(blockId);
  wideListeners.forEach((l) => l());
}
export function useTableWide(blockId: string): boolean {
  return useSyncExternalStore(
    (l) => {
      wideListeners.add(l);
      return () => {
        wideListeners.delete(l);
      };
    },
    () => wide.has(blockId)
  );
}

// How far a wide table is scrolled: kept so that waking the locked table (a tap) or putting it away again does not throw it back to its start.
const scrolled = new Map<string, number>();
export function setTableScrollX(blockId: string, x: number) {
  scrolled.set(blockId, x);
}
export function tableScrollX(blockId: string): number {
  return scrolled.get(blockId) ?? 0;
}
