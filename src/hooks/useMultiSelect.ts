import { useRef, useState } from 'react';
import { FEATURES } from '../features';
import { hapticSelectItem, hapticSelectMode, hapticSelectTap } from '../utils/haptics';

// Shared select-mode state for Files/Photos/Links (see BulkActionBar) - a
// header toggle turns selection on/off, tapping a row in that mode toggles
// membership instead of opening the item.
export function useMultiSelect() {
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;

  function toggleSelectMode() {
    hapticSelectMode();
    setIsSelectMode((prev) => !prev);
    setSelectedIds(new Set());
  }

  function toggle(id: string) {
    hapticSelectTap();
    const next = new Set(selectedRef.current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedRef.current = next;
    setSelectedIds(next);
    // The last picked card let go by a tap ends the mode, as a swipe does (2026-10-19, the user's).
    if (next.size === 0 && FEATURES.swipeSelect) setIsSelectMode(false);
  }

  // Held down on a row that was not moving: selection starts WITH that
  // row, the way a held block does in the editor. Already selecting, the
  // hold is just one more tap.
  function enterWith(id: string) {
    hapticSelectMode();
    setIsSelectMode(true);
    setSelectedIds(new Set([id]));
  }

  // Everything on screen at once - which is whatever the project or the
  // smartfolder in front has left there, so "the whole folder" is one
  // tap after opening it.
  function selectMany(ids: string[]) {
    hapticSelectItem();
    setSelectedIds(new Set(ids));
  }

  // A swipe that picks as it goes (components/SwipeSelect): the whole set each time it changes. The first pick turns
  // the mode on with the heavier tick; the rest are the light one.
  function sweepTo(ids: Set<string>) {
    setSelectedIds(ids);
    if (ids.size > 0) setIsSelectMode(true);
  }

  function clear() {
    setSelectedIds(new Set());
    setIsSelectMode(false);
  }

  return { isSelectMode, selectedIds, toggleSelectMode, toggle, enterWith, selectMany, sweepTo, clear };
}
