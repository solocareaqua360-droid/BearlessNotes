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
