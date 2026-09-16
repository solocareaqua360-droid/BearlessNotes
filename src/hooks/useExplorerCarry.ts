import { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import type { FlatList } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import type { SharedValue } from 'react-native-reanimated';
import { useCardCarry } from './useCardCarry';

// Longer than a plain short hold - the user's own two-hold-length rule:
// a short one opens the card's menu, a longer one lifts it.
const CARRY_LONG_PRESS_MS = 650;
// What "short" means for the menu - long enough that a tap or a quick
// scroll flick never reaches it, short enough to stay clear of the one
// above.
const MENU_HOLD_MS = 380;

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
  isSelectMode,
  selectedIds,
  onMoved,
  active,
}: {
  // Where the explorer is standing - where a card let go over nothing in
  // particular lands.
  path: string;
  folders: { fullPath: string; name: string }[];
  moveItem: (item: T, destination: string | null) => Promise<void>;
  // Everything in the database - what a bulk group is drawn from, and
  // what undo looks a moved record up in.
  items: T[];
  isSelectMode?: boolean;
  selectedIds?: Set<string>;
  // After a real move - to clear a selection, say.
  onMoved?: () => void;
  // Only the explorer carries cards into folders: everywhere else there
  // are no folders to carry them to, and a long hold should stay what it
  // always was.
  active: boolean;
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

  // The one gesture, on the LIST rather than on a row - see useCardCarry.
  // A quick swipe fails it before the long press elapses, so the list
  // goes on scrolling exactly as it did; a hold that outlasts the menu
  // lifts whatever is under the finger.
  const downAt = useRef({ at: 0, x: 0, y: 0 });
  const listGesture = Gesture.Pan()
    .enabled(active)
    .activateAfterLongPress(CARRY_LONG_PRESS_MS)
    .runOnJS(true)
    .onBegin((e) => {
      downAt.current = { at: Date.now(), x: e.absoluteX, y: e.absoluteY };
    })
    .onStart((e) => carry.pickUpAt(e.absoluteX, e.absoluteY))
    .onUpdate((e) => carry.updateCarry(e.absoluteX, e.absoluteY))
    .onEnd((_e, success) => {
      if (success) {
        carry.endCarry();
      } else if (Date.now() - downAt.current.at >= MENU_HOLD_MS) {
        // Not long enough to lift, longer than a tap: the short hold,
        // which is the card's own menu - opened on this gesture's clock
        // rather than racing a second one.
        carry.menuAt(downAt.current.x, downAt.current.y);
      }
    })
    // A safety net, not the usual path.
    .onFinalize(() => carry.cancelCarry());

  // What a row picks up: itself, or - when it is one of several ticked -
  // all of them, so a bulk move is the same gesture rather than a second
  // way of doing it.
  function groupFor(item: T): T[] {
    if (isSelectMode && selectedIds?.has(item.id) && selectedIds.size > 1) {
      return items.filter((one) => selectedIds.has(one.id));
    }
    return [item];
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
    listGesture,
    groupFor,
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
