import { useState } from 'react';
import { hapticSelectItem, hapticSelectMode } from '../utils/haptics';

// Shared select-mode state for Files/Photos/Links (see BulkActionBar) - a
// header toggle turns selection on/off, tapping a row in that mode toggles
// membership instead of opening the item.
export function useMultiSelect() {
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelectMode() {
    hapticSelectMode();
    setIsSelectMode((prev) => !prev);
    setSelectedIds(new Set());
  }

  function toggle(id: string) {
    hapticSelectItem();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Held down on a row that was not moving: selection starts WITH that
  // row, the way a held block does in the editor. Already selecting, the
  // hold is just one more tap.
  function enterWith(id: string) {
    hapticSelectMode();
    setIsSelectMode(true);
    setSelectedIds(new Set([id]));
  }

  function clear() {
    setSelectedIds(new Set());
    setIsSelectMode(false);
  }

  return { isSelectMode, selectedIds, toggleSelectMode, toggle, enterWith, clear };
}
