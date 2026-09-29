// The keyboard, where there is one. A phone has none, so this does nothing
// there - the whole implementation is in the .web sibling.
export type BoardKeyHandlers = {
  // False while another screen is in front, or the board is not the thing
  // being looked at: a key pressed elsewhere must never reach the board.
  active: boolean;
  onDelete: () => void;
  onEscape: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onSelectAll: () => void;
};

export function useBoardKeys(_handlers: BoardKeyHandlers): void {}
