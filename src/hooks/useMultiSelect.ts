import { useState } from 'react';

// Shared select-mode state for Files/Photos/Links (see BulkActionBar) - a
// header toggle turns selection on/off, tapping a row in that mode toggles
// membership instead of opening the item.
export function useMultiSelect() {
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelectMode() {
    setIsSelectMode((prev) => !prev);
    setSelectedIds(new Set());
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clear() {
    setSelectedIds(new Set());
    setIsSelectMode(false);
  }

  return { isSelectMode, selectedIds, toggleSelectMode, toggle, clear };
}
