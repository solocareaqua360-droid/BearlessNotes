import { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import type { FlatList } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { useCardCarry } from './useCardCarry';

// Everything a screen needs to let its cards be carried into folders,
// in one piece - because the wiring is the same on every one of them and
// four copies of it are four screens that drift (the same reason
// useExplorer itself exists).
//
// What a screen still does itself: wrap its rows in CarryableRow, hand
// ExplorerHead the folderRef, mount CardCarryOverlay, and give its list
// the ref and the scroll offset the chrome hands down.
export function useExplorerCarry<T extends { id: string }>({
  path,
  folders,
  moveItem,
  items,
  visibleItems,
  isSelectMode,
  selectedIds,
  onMoved,
}: {
  // Where the explorer is standing - where a card let go over nothing in
  // particular lands.
  path: string;
  folders: { fullPath: string; name: string }[];
  moveItem: (item: T, destination: string | null) => Promise<void>;
  // Everything in the database, and what this level is showing. The
  // first is how a carried card is found again once the second finger
  // has walked somewhere it does not belong.
  items: T[];
  visibleItems: T[];
  isSelectMode?: boolean;
  selectedIds?: Set<string>;
  // After a real move - to clear a selection, say.
  onMoved?: () => void;
}) {
  const scrollRef = useRef<ScrollView | FlatList<T>>(null);
  const scrollYRef = useRef<SharedValue<number> | null>(null);
  const scrollTargetRef = useRef<{ y: number; at: number } | null>(null);
  const [movedToast, setMovedToast] = useState<{ ids: string[]; origin: string; folderName: string } | null>(null);

  const carry = useCardCarry<T>({
    currentPath: path,
    moveItem,
    // The list's own scrollY only catches up through its onScroll event,
    // a frame or two behind - reading it every tick of a fast drag would
    // keep computing from a stale number and stutter. So the live value
    // only SEEDS this: once a drag is under way it accumulates its own
    // target, and re-seeds when the finger has been still long enough
    // for the list to have caught up.
    scrollBy: (dy) => {
      const live = scrollYRef.current;
      if (!live) return;
      const now = Date.now();
      const carried = scrollTargetRef.current;
      const base = carried && now - carried.at < 250 ? carried.y : live.value;
      const next = Math.max(0, base - dy);
      scrollTargetRef.current = { y: next, at: now };
      const list = scrollRef.current;
      if (!list) return;
      if ('scrollToOffset' in list) list.scrollToOffset({ offset: next, animated: false });
      else list.scrollTo({ y: next, animated: false });
    },
    onMoved: (moved, destination, origin) => {
      const folderName =
        folders.find((f) => f.fullPath === destination)?.name ?? (destination ?? '').split('/').pop() ?? '';
      // IDs, not records: moveItem reads the tags off the object it is
      // handed, and by then these are snapshots from BEFORE the move -
      // still carrying the old folder's tags and not the new one's. Undo
      // would detach tags they no longer have and, from the root, return
      // having done nothing at all.
      setMovedToast({ ids: moved.map((one) => one.id), origin, folderName });
      onMoved?.();
    },
  });

  useEffect(() => {
    if (!movedToast) return;
    const id = setTimeout(() => setMovedToast(null), 4000);
    return () => clearTimeout(id);
  }, [movedToast]);

  // A carried card stays in the list even after the second finger has
  // stepped into a folder where it does not belong - drawn as nothing,
  // taking no room (CarryableRow's `orphan`), purely so its row - and
  // with it the drag gesture - is never unmounted mid-carry.
  const carriedIds = carry.ghost?.items.map((one) => one.id) ?? [];
  const orphans = carriedIds
    .filter((id) => !visibleItems.some((one) => one.id === id))
    .map((id) => items.find((one) => one.id === id))
    .filter((one): one is T => !!one);
  const listed = orphans.length > 0 ? [...visibleItems, ...orphans] : visibleItems;

  // What a row picks up: itself, or - when it is one of several ticked -
  // all of them, so a bulk move is the same gesture rather than a second
  // way of doing it.
  function groupFor(item: T): T[] {
    if (isSelectMode && selectedIds?.has(item.id) && selectedIds.size > 1) {
      return items.filter((one) => selectedIds.has(one.id));
    }
    return [item];
  }

  function isOrphan(item: T) {
    return orphans.some((one) => one.id === item.id);
  }

  function undoMove() {
    if (!movedToast) return;
    const back = movedToast.origin || null;
    movedToast.ids
      .map((id) => items.find((one) => one.id === id))
      .filter((one): one is T => !!one)
      .reduce<Promise<unknown>>((run, one) => run.then(() => moveItem(one, back)), Promise.resolve());
    setMovedToast(null);
  }

  return {
    carry,
    listed,
    groupFor,
    isOrphan,
    scrollRef,
    scrollYRef,
    movedToast,
    undoMove,
    toastMessage: movedToast
      ? movedToast.ids.length > 1
        ? `Переміщено ${movedToast.ids.length} в «${movedToast.folderName}»`
        : `Переміщено в «${movedToast.folderName}»`
      : '',
  };
}
