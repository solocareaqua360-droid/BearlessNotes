import { ForwardedRef, forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { LayoutAnimation, LayoutChangeEvent, TextInput, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Block, Tag } from '../types';
import { useStyles } from '../theme/ThemeProvider';
import { makeStyles } from './documentEditorStyles';
import type { colorForDocument } from '../utils/documentColor';
import { hapticDrop, hapticPickUp, hapticSelectMode, hapticSnapTick, hapticSweepTick } from '../utils/haptics';
import SortableBlockRow from './SortableBlockRow';
import type { DocumentIndex } from '../hooks/useDocumentIndex';
import { useBlockMarquee } from '../hooks/useBlockMarquee';
import { useDensity } from '../hooks/useDensity';

// Pulled out of DocumentEditorScreen.tsx (2026-09-19) alongside BlockRow/
// SortableBlockRow - a plain, prop-only component.
type BlockListProps = {
  // Passed straight through to every row - see BlockRow's own hideHandle.
  hideHandle?: boolean;
  searchHighlight?: string;
  // The block a link just landed on - see SortableBlockRow's flash.
  flashBlockId?: string | null;
  // Only the first this-many rows are drawn - a long note's opening draws
  // what the screen shows first and the rest a moment later (the editor's
  // renderAll). Absent = all of them.
  renderCount?: number;
  blocks: Block[];
  onReorder: (blocks: Block[]) => void;
  // A hold that never went anywhere. The drag gesture already waits out
  // a long press before it activates, so by the time the finger lifts
  // without having moved, the user has held a block and asked for
  // something - and until now that something was nothing at all.
  //
  // The user's own design: that hold turns select mode on with this
  // block already ticked. Two outcomes from ONE hold, told apart by what
  // the hand does next rather than by how long it waits - hold and move
  // is a drag, hold and let go is a selection. Nothing to learn and no
  // threshold to feel for, which is exactly why this is not split by
  // duration (a second, longer press would sit INSIDE the wait the drag
  // already needs, and a slow hand would trip it on the way to dragging).
  onHoldWithoutDrag?: (id: string) => void;
  // At a pointer: press and drag across blocks picks them - the whole set
  // each time it changes (see useBlockMarquee).
  onSelectRange?: (ids: string[]) => void;
  // A click on the empty place: the pick is let go (only told while there is one).
  onClearSelect?: () => void;
  // SWIPE TO SELECT, like Craft (features.swipeSelect): a swipe left on a block picks it (or, on a picked one, lets it
  // go), and the finger carried on over the blocks around does the same to every block it passes. The whole picked set
  // each time it changes, and once more when the finger lifts.
  onSweepSelect?: (ids: Set<string>) => void;
  onSweepEnd?: (ids: Set<string>) => void;
  // Where the finger is during a sweep (null once it lifts), for the screen to scroll along at the edges; and how far
  // the screen is scrolled, so the finger is read in the list's own space while the list moves under it.
  onSweepEdge?: (absoluteY: number | null) => void;
  getScrollY?: () => number;
  selectedIds: Set<string>;
  isSelectMode: boolean;
  focusedBlockId: string | null;
  // cursorIndex: DISPLAY-text position to place the cursor at (from a tap on
  // the locked text); omitted = end of the text.
  onActivate: (id: string, cursorIndex?: number) => void;
  onBlur: (id: string) => void;
  textVersions: Record<string, number>;
  onToggleSelected: (id: string) => void;
  onToggleChecked: (id: string) => void;
  onOpenReminder: (id: string) => void;
  onUpdateBlock: (id: string, patch: Partial<Block>) => void;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  onFocus: (id: string) => void;
  onSelectionChange: (id: string, start: number, end: number) => void;
  onOpenImage: (id: string) => void;
  onToggleImageFit: (id: string) => void;
  onDrawOverImage: (id: string) => void;
  onOpenFile: (id: string) => void;
  onDownloadFile: (id: string) => void;
  onOpenFileDatabase: () => void;
  onOpenLink: (url: string) => void;
  onOpenLinkDatabase: (block: Block) => void;
  onTimecode?: (blockId: string, seconds: number) => void;
  onNoteLink?: (documentId: string) => void;
  onNoteLinkMenu?: (blockId: string, documentId: string, label: string) => void;
  // A link to a note nested in this one - drawn with the arrow down.
  isNestedLink?: (ref: string) => boolean;
  onOpenSketch: (id: string) => void;
  // 'dbRow' blocks only - the full tag list (the card filters it by the
  // live row's own tagIds) and "open this row in its database".
  allTags: Tag[];
  onOpenCustomRow: (databaseId: string, rowId: string) => void;
  // Passed straight through to a 'docRef' row - see BlockRow.
  documentIndex?: DocumentIndex;
  onOpenDocument?: (documentId: string) => void;
  // 'dbView' blocks only - "open this view's own database, with that view
  // applied" (tapping the block's header, as opposed to one of its rows).
  onOpenCustomView: (databaseId: string, viewId: string) => void;
  onInputRef: (id: string, ref: TextInput | null) => void;
  // See BlockRow: the field keeps focus while the insert panel stands
  // where the keyboard was.
  softInputDisabled?: boolean;
  paperColor: ReturnType<typeof colorForDocument> | null;
};

// Dropping something onto the page from OUTSIDE the list - a record
// dragged out of «Референси». The list already knows where a gap is and
// how to draw the line in it; what it does not know is anything about
// the finger, because that gesture belongs to the panel, not to a row.
// So the panel asks in SCREEN coordinates and the list answers in its
// own - the same shape as DocumentCanvasHandle.screenToSurface, and
// asynchronous for the same reason: measuring against the window is.
export type BlockListHandle = {
  // Moves the drop-line to wherever this point falls and answers with
  // the index a drop would use, or null when the point is not over the
  // list at all.
  hoverExternal: (screenY: number, answer?: (index: number | null) => void) => void;
  endExternalHover: () => void;
  // Where a block sits inside the list, for scrolling to it. Null until
  // that row has been laid out - the caller is expected to ask again.
  offsetOf: (blockId: string) => number | null;
  // The note scrolled under a finger that stands still: the sweep reads where it now is.
  sweepRefresh: () => void;
};

const NOTHING_DRAGGING: Set<string> = new Set();

// The mid-drag snap, same as a block being reordered uses - see
// handleDragUpdate on why it clamps the overshoot.
const DROP_LINE_SPRING = { damping: 26, stiffness: 260, overshootClamping: true };

function BlockList({
  blocks,
  onReorder,
  onHoldWithoutDrag,
  onSelectRange,
  onClearSelect,
  onSweepSelect,
  onSweepEnd,
  onSweepEdge,
  getScrollY,
  selectedIds,
  isSelectMode,
  focusedBlockId,
  onActivate,
  onBlur,
  textVersions,
  onToggleSelected,
  onToggleChecked,
  onOpenReminder,
  onUpdateBlock,
  onChangeText,
  onBackspaceEmpty,
  onFocus,
  onSelectionChange,
  onOpenImage,
  onToggleImageFit,
  onDrawOverImage,
  onOpenFile,
  onDownloadFile,
  onOpenFileDatabase,
  onOpenLink,
  onOpenLinkDatabase,
  onTimecode,
  onNoteLink,
  onNoteLinkMenu,
  isNestedLink,
  onOpenSketch,
  allTags,
  onOpenCustomRow,
  documentIndex,
  onOpenDocument,
  onOpenCustomView,
  onInputRef,
  softInputDisabled,
  paperColor,
  hideHandle,
  searchHighlight,
  flashBlockId,
  renderCount,
}: BlockListProps, ref: ForwardedRef<BlockListHandle>) {
  const styles = useStyles(makeStyles);
  const [draggingIds, setDraggingIds] = useState<string[] | null>(null);
  // The block actually long-pressed to start the drag - the rest of a
  // multi-select group should visually collapse toward this one, not each
  // toward its own separate center.
  const [dragAnchorId, setDragAnchorId] = useState<string | null>(null);
  const [insertIndex, setInsertIndexState] = useState<number | null>(null);
  const insertIndexRef = useRef<number | null>(null);
  const dropLineY = useSharedValue(0);
  // Extra horizontal inset applied to the drop line while it's actively
  // being dragged between gaps (making it "trохи коротшою" / a bit
  // shorter); it eases back to 0 (full width) as part of the final settle.
  const dropLineInset = useSharedValue(0);
  const rowLayouts = useRef<Record<string, { y: number; height: number }>>({});
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  // See BlockListHandle - a drop coming from outside the list.
  const containerRef = useRef<View | null>(null);
  const pointer = useDensity() === 'pointer';
  useBlockMarquee(
    containerRef,
    pointer && !!onSelectRange,
    (ids) => onSelectRange?.(ids),
    () => {
      if (isSelectMode) onClearSelect?.();
    }
  );
  const [externalIndex, setExternalIndexState] = useState<number | null>(null);
  const externalIndexRef = useRef<number | null>(null);
  // Did this drag actually go anywhere? See onHoldWithoutDrag.
  const dragMovedRef = useRef(false);

  function setInsertIndex(index: number | null) {
    insertIndexRef.current = index;
    setInsertIndexState(index);
  }

  function setExternalIndex(index: number | null) {
    if (externalIndexRef.current === index) return;
    // The same tick a block being reordered gives at every gap it passes.
    if (index !== null) hapticSnapTick();
    externalIndexRef.current = index;
    setExternalIndexState(index);
  }

  useImperativeHandle(ref, () => ({
    hoverExternal: (screenY, answer) => {
      const node = containerRef.current;
      if (!node) {
        answer?.(null);
        return;
      }
      node.measureInWindow((_x, y, _width, height) => {
        const over = screenY >= y && screenY <= y + height;
        const index = over ? computeInsertIndex(screenY - y, NOTHING_DRAGGING) : null;
        setExternalIndex(index);
        if (index !== null) dropLineY.value = withSpring(gapYFor(index, NOTHING_DRAGGING), DROP_LINE_SPRING);
        answer?.(index);
      });
    },
    endExternalHover: () => setExternalIndex(null),
    // Where a row sits, so the screen can scroll to it - see the
    // editor's focusLinkTo. Null while that row has not been laid out
    // yet, which is the first frame after opening a long note.
    offsetOf: (blockId: string) => rowLayouts.current[blockId]?.y ?? null,
    sweepRefresh: () => {
      const sweep = sweepRef.current;
      if (sweep && sweep.lastY !== null) handleSweepUpdate(sweep.anchor, sweep.lastY, 0);
    },
  }));

  function handleRowLayout(id: string, e: LayoutChangeEvent) {
    rowLayouts.current[id] = {
      y: e.nativeEvent.layout.y,
      height: e.nativeEvent.layout.height,
    };
  }

  // Y position of the "gap" before the block that would sit at `index`
  // within the list of NON-dragged blocks (or after the last one, if index
  // is past the end) - where the drop-line sits. Dragged blocks (a single
  // one, or a whole multi-select group) never move during the gesture, so
  // this always reads straight from their last measured, still-accurate
  // layout.
  function gapYFor(index: number, draggingSet: Set<string>): number {
    const remaining = blocksRef.current.filter((b) => !draggingSet.has(b.id));
    if (remaining.length === 0) return 0;
    if (index <= 0) return rowLayouts.current[remaining[0].id]?.y ?? 0;
    if (index >= remaining.length) {
      const last = remaining[remaining.length - 1];
      const rl = rowLayouts.current[last.id];
      return rl ? rl.y + rl.height : 0;
    }
    return rowLayouts.current[remaining[index].id]?.y ?? 0;
  }

  // How many non-dragged blocks have their midpoint above this Y - i.e.
  // where the dragged block(s) would land among the OTHER blocks if
  // dropped now. Nothing is actually reordered until the gesture ends.
  function computeInsertIndex(currentY: number, draggingSet: Set<string>): number {
    const list = blocksRef.current;
    let index = 0;
    for (let i = 0; i < list.length; i++) {
      if (draggingSet.has(list[i].id)) continue;
      const rl = rowLayouts.current[list[i].id];
      if (!rl) continue;
      if (currentY > rl.y + rl.height / 2) {
        index++;
      }
    }
    return index;
  }

  // A long-press on a block that's part of a multi-selection (2+ selected)
  // drags the whole selected group together, in their existing relative
  // order; otherwise it's just that one block, same as before select mode
  // and bulk move existed.
  function dragGroupFor(anchorId: string): string[] {
    if (isSelectMode && selectedIds.has(anchorId) && selectedIds.size > 1) {
      return blocksRef.current.filter((b) => selectedIds.has(b.id)).map((b) => b.id);
    }
    return [anchorId];
  }

  function handleDragStart(anchorId: string, ids: string[]) {
    // Reset per gesture - see onHoldWithoutDrag. Deliberately NOT a state
    // update: select mode is entered on RELEASE, not here, because
    // turning it on mid-gesture re-renders the row and recomposes the
    // very gesture that is running (isSelectMode decides whether the
    // TextInput's own handling is composed in), and a drag does not
    // survive its own gesture being rebuilt under it.
    dragMovedRef.current = false;
    hapticPickUp();
    setDraggingIds(ids);
    setDragAnchorId(anchorId);
    const layout = rowLayouts.current[anchorId];
    const draggingSet = new Set(ids);
    const currentIndex = layout
      ? computeInsertIndex(layout.y + layout.height / 2, draggingSet)
      : 0;
    setInsertIndex(currentIndex);
    dropLineY.value = gapYFor(currentIndex, draggingSet);
    dropLineInset.value = withTiming(14, { duration: 150 });
  }

  function handleDragUpdate(anchorId: string, ids: string[], translationY: number) {
    // A few points of travel is a steady hand, not a drag.
    if (Math.abs(translationY) > 6) dragMovedRef.current = true;
    const layout = rowLayouts.current[anchorId];
    if (!layout) return;
    const draggingSet = new Set(ids);
    const currentY = layout.y + translationY + layout.height / 2;
    const targetIndex = computeInsertIndex(currentY, draggingSet);
    if (targetIndex !== insertIndexRef.current) {
      hapticSnapTick();
      setInsertIndex(targetIndex);
      // overshootClamping stops it swinging past the target and settling
      // back - the "rocking like a boat" feeling - while keeping the same
      // eased, springy deceleration on the way there. The little bounce the
      // user actually wants only happens once, at the very end of the drag
      // (see handleDragEnd), not on every one of these mid-drag snaps.
      dropLineY.value = withSpring(gapYFor(targetIndex, draggingSet), {
        damping: 26,
        stiffness: 260,
        overshootClamping: true,
      });
    }
  }

  function commitReorder(ids: string[]) {
    const targetIndex = insertIndexRef.current;
    const list = blocksRef.current;
    if (targetIndex !== null) {
      const draggingSet = new Set(ids);
      const draggedBlocks = list.filter((b) => draggingSet.has(b.id));
      const remaining = list.filter((b) => !draggingSet.has(b.id));
      const next = [...remaining];
      next.splice(targetIndex, 0, ...draggedBlocks);
      const changed = next.some((b, i) => b.id !== list[i]?.id);
      if (changed) {
        hapticDrop();
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        onReorder(next);
      }
    }
    setDraggingIds(null);
    setDragAnchorId(null);
    setInsertIndex(null);
  }

  // THE SWEEP (see onSweepSelect). Started on one block: it decides whether this sweep picks or lets go (a block
  // already picked lets go), and the set as it was is the base every step starts from again - so carrying the finger
  // back undoes what it passed. Where the finger is, is read in the list's own space: rows above it may grow or
  // shrink when select mode draws its ticks, and the measured rows follow that, a translation from the start would not.
  const sweepRef = useRef<{
    anchor: string;
    picks: boolean;
    base: Set<string>;
    listTop: number | null;
    scrollAtStart: number;
    lastY: number | null;
    range: string;
    last: Set<string>;
  } | null>(null);

  function sweepApply(targetId: string) {
    const sweep = sweepRef.current;
    if (!sweep) return;
    const list = blocksRef.current;
    const a = list.findIndex((b) => b.id === sweep.anchor);
    const t = list.findIndex((b) => b.id === targetId);
    if (a < 0 || t < 0) return;
    const from = Math.min(a, t);
    const to = Math.max(a, t);
    const range = `${from}:${to}`;
    if (range === sweep.range) return;
    if (sweep.range) hapticSweepTick();
    sweep.range = range;
    const next = new Set(sweep.base);
    for (let i = from; i <= to; i++) {
      if (sweep.picks) next.add(list[i].id);
      else next.delete(list[i].id);
    }
    sweep.last = next;
    onSweepSelect?.(next);
  }

  function handleSweepStart(anchorId: string) {
    const picks = !(isSelectMode && selectedIds.has(anchorId));
    sweepRef.current = {
      anchor: anchorId,
      picks,
      base: new Set(isSelectMode ? selectedIds : []),
      listTop: null,
      scrollAtStart: getScrollY?.() ?? 0,
      lastY: null,
      range: '',
      last: new Set(selectedIds),
    };
    containerRef.current?.measureInWindow((_x, y) => {
      // Measured a moment after the start: read back to the scroll offset of the start.
      if (sweepRef.current) sweepRef.current.listTop = y + ((getScrollY?.() ?? 0) - sweepRef.current.scrollAtStart);
    });
    // Entering the mode is the heavier tick; inside it, a block is the light one.
    if (isSelectMode) hapticSweepTick();
    else hapticSelectMode();
    sweepApply(anchorId);
  }

  function handleSweepUpdate(anchorId: string, absoluteY: number, translationY: number) {
    const sweep = sweepRef.current;
    if (!sweep) return;
    sweep.lastY = absoluteY;
    onSweepEdge?.(absoluteY);
    const anchor = rowLayouts.current[anchorId];
    const scrolled = (getScrollY?.() ?? 0) - sweep.scrollAtStart;
    const y =
      sweep.listTop !== null
        ? absoluteY - sweep.listTop + scrolled
        : anchor
          ? anchor.y + anchor.height / 2 + translationY + scrolled
          : null;
    if (y === null) return;
    // The row under the finger; past the first or the last drawn row, that row.
    let target: string | null = null;
    let first: string | null = null;
    let last: string | null = null;
    for (const b of blocksRef.current) {
      const rl = rowLayouts.current[b.id];
      if (!rl) continue;
      if (first === null) first = b.id;
      last = b.id;
      if (y >= rl.y && y < rl.y + rl.height) {
        target = b.id;
        break;
      }
    }
    if (target === null) {
      const top = first ? rowLayouts.current[first] : null;
      target = top && y < top.y ? first : last;
    }
    if (target) sweepApply(target);
  }

  function handleSweepEnd() {
    const sweep = sweepRef.current;
    sweepRef.current = null;
    if (sweep) onSweepEdge?.(null);
    if (sweep) onSweepEnd?.(sweep.last);
  }

  // How far (in px) this row needs to travel to visually converge on the
  // anchor row's center - 0 for the anchor itself, and 0 for anything not
  // currently part of the drag. Layouts are stable during a drag (nothing
  // moves until release), so this stays constant for the gesture's duration.
  function compressOffsetFor(id: string): number {
    if (!dragAnchorId || !draggingIds?.includes(id)) return 0;
    const anchorLayout = rowLayouts.current[dragAnchorId];
    const thisLayout = rowLayouts.current[id];
    if (!anchorLayout || !thisLayout) return 0;
    const anchorCenter = anchorLayout.y + anchorLayout.height / 2;
    const thisCenter = thisLayout.y + thisLayout.height / 2;
    return anchorCenter - thisCenter;
  }

  function handleDragEnd(anchorId: string, ids: string[]) {
    // Held, and let go where it stood: the hold was a request to select,
    // not to move. Safe here in a way it would not have been at the
    // start - the gesture is over, so re-rendering the row costs nothing.
    if (!dragMovedRef.current) onHoldWithoutDrag?.(anchorId);
    dropLineInset.value = withTiming(0, { duration: 200 });
    // A synthetic velocity makes the spring overshoot its target and settle
    // back even though it's often already resting there (no natural
    // distance left to travel) - a small, deliberate "landing" bounce that
    // only plays once, here, instead of on every mid-drag snap above.
    const targetIndex = insertIndexRef.current;
    const draggingSet = new Set(ids);
    dropLineY.value = withSpring(
      gapYFor(targetIndex ?? 0, draggingSet),
      { damping: 12, stiffness: 300, velocity: 260 },
      (finished) => {
        if (finished) runOnJS(commitReorder)(ids);
      }
    );
  }

  const dropLineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dropLineY.value - 2 }],
    left: 8 + dropLineInset.value,
    right: 8 + dropLineInset.value,
  }));

  // Numbering restarts after any non-numbered block breaks the run, like a
  // real numbered list rather than a permanently incrementing counter.
  let runningNumber = 0;
  // The same run isUnderToggle answers one position at a time, done once
  // for the whole list instead of once per row - "важко орієнтуватись
  // який блок вкладений": nothing drew this before, so the only way to
  // tell was to collapse the toggle and see what vanished.
  let indented = false;

  // EVERY ROW RENDERS ONLY WHEN ITS OWN THINGS CHANGE (2026-10-06). The
  // screen hands this list new handler functions on every one of its
  // renders - each keystroke, each of the dozen renders of opening a note -
  // and every row took them, so every row of the note re-rendered every
  // time. The rows now get STABLE functions that call whatever the screen's
  // latest handler is (so none of them is ever stale), per-row callbacks
  // made once per block, and SortableBlockRow is memoised.
  const live = useRef<Record<string, unknown>>({});
  live.current = {
    onActivate, onBlur, onToggleSelected, onToggleChecked, onOpenReminder, onUpdateBlock, onChangeText,
    onBackspaceEmpty, onFocus, onSelectionChange, onOpenImage, onToggleImageFit, onDrawOverImage, onOpenFile,
    onDownloadFile, onOpenFileDatabase, onOpenLink, onOpenLinkDatabase, onTimecode, onNoteLink, onNoteLinkMenu,
    isNestedLink, onOpenSketch, onOpenCustomRow, onOpenDocument, onOpenCustomView, onInputRef, onHoldWithoutDrag,
    handleRowLayout, handleDragStart, handleDragUpdate, handleDragEnd, dragGroupFor,
    handleSweepStart, handleSweepUpdate, handleSweepEnd,
  };
  const call = (key: string) => (live.current[key] as ((...args: unknown[]) => unknown) | undefined);
  const stable = useMemo(() => {
    const via = (key: string) => (...args: unknown[]) => call(key)?.(...args);
    return {
      onActivate: via('onActivate'),
      onBlur: via('onBlur'),
      onToggleSelected: via('onToggleSelected'),
      onToggleChecked: via('onToggleChecked'),
      onOpenReminder: via('onOpenReminder'),
      onUpdateBlock: via('onUpdateBlock'),
      onChangeText: via('onChangeText'),
      onBackspaceEmpty: via('onBackspaceEmpty'),
      onFocus: via('onFocus'),
      onSelectionChange: via('onSelectionChange'),
      onOpenImage: via('onOpenImage'),
      onToggleImageFit: via('onToggleImageFit'),
      onDrawOverImage: via('onDrawOverImage'),
      onOpenFile: via('onOpenFile'),
      onDownloadFile: via('onDownloadFile'),
      onOpenFileDatabase: via('onOpenFileDatabase'),
      onOpenLink: via('onOpenLink'),
      onOpenLinkDatabase: via('onOpenLinkDatabase'),
      onTimecode: via('onTimecode'),
      onNoteLink: via('onNoteLink'),
      onNoteLinkMenu: via('onNoteLinkMenu'),
      isNestedLink: (ref: string) => !!call('isNestedLink')?.(ref),
      onOpenSketch: via('onOpenSketch'),
      onOpenCustomRow: via('onOpenCustomRow'),
      onOpenDocument: via('onOpenDocument'),
      onOpenCustomView: via('onOpenCustomView'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  type RowFns = {
    onLayout: (e: LayoutChangeEvent) => void;
    onDragStart: () => void;
    onDragUpdate: (translationY: number) => void;
    onDragEnd: () => void;
    onHandleClick: () => void;
    onSweepStart: () => void;
    onSweepUpdate: (absoluteY: number, translationY: number) => void;
    onSweepEnd: () => void;
    inputRef: (node: TextInput | null) => void;
  };
  const rowFnsCache = useRef(new Map<string, RowFns>());
  const rowFns = (id: string): RowFns => {
    let fns = rowFnsCache.current.get(id);
    if (!fns) {
      const group = () => (call('dragGroupFor')?.(id) as string[]);
      fns = {
        onLayout: (e) => call('handleRowLayout')?.(id, e),
        onDragStart: () => call('handleDragStart')?.(id, group()),
        onDragUpdate: (translationY) => call('handleDragUpdate')?.(id, group(), translationY),
        onDragEnd: () => call('handleDragEnd')?.(id, group()),
        onHandleClick: () => call('onHoldWithoutDrag')?.(id),
        onSweepStart: () => call('handleSweepStart')?.(id),
        onSweepUpdate: (absoluteY, translationY) => call('handleSweepUpdate')?.(id, absoluteY, translationY),
        onSweepEnd: () => call('handleSweepEnd')?.(),
        inputRef: (node) => call('onInputRef')?.(id, node),
      };
      rowFnsCache.current.set(id, fns);
    }
    return fns;
  };

  return (
    <View ref={containerRef} collapsable={false} style={styles.blockListContainer}>
      {(renderCount !== undefined && renderCount < blocks.length ? blocks.slice(0, renderCount) : blocks).map((item, index) => {
        if (item.type === 'numbered') {
          runningNumber = index > 0 && blocks[index - 1].type === 'numbered' ? runningNumber + 1 : 1;
        } else {
          runningNumber = 0;
        }
        // A toggle's own row is never indented - it is the section's
        // header, not its content - so this reads the state left over
        // from BEFORE it and only then turns indenting on for what
        // follows. An `exitsToggle` row is the reverse: the line that
        // steps back out is itself back at the top level, so it turns
        // indenting off before it is drawn, not after.
        if (item.exitsToggle) indented = false;
        const rowIndented = indented;
        if (item.type === 'toggle') indented = true;
        return (
        <SortableBlockRow
          key={item.id}
          item={item}
          hideHandle={hideHandle}
          searchHighlight={searchHighlight}
          flash={flashBlockId === item.id}
          indented={rowIndented}
          isSelected={selectedIds.has(item.id)}
          isSelectMode={isSelectMode}
          isActive={focusedBlockId === item.id}
          onActivate={stable.onActivate}
          onBlur={stable.onBlur}
          isDragging={draggingIds?.includes(item.id) ?? false}
          isDragActive={draggingIds !== null}
          listNumber={item.type === 'numbered' ? runningNumber : undefined}
          textVersion={textVersions[item.id] ?? 0}
          compressTowardOffset={compressOffsetFor(item.id)}
          onLayout={rowFns(item.id).onLayout}
          onDragStart={rowFns(item.id).onDragStart}
          onDragUpdate={rowFns(item.id).onDragUpdate}
          onDragEnd={rowFns(item.id).onDragEnd}
          onHandleClick={rowFns(item.id).onHandleClick}
          swipeSelect={!!onSweepSelect}
          onSweepStart={rowFns(item.id).onSweepStart}
          onSweepUpdate={rowFns(item.id).onSweepUpdate}
          onSweepEnd={rowFns(item.id).onSweepEnd}
          onToggleSelected={stable.onToggleSelected}
          onToggleChecked={stable.onToggleChecked}
          onOpenReminder={stable.onOpenReminder}
          onUpdateBlock={stable.onUpdateBlock}
          onChangeText={stable.onChangeText}
          onBackspaceEmpty={stable.onBackspaceEmpty}
          onFocus={stable.onFocus}
          onSelectionChange={stable.onSelectionChange}
          onOpenImage={stable.onOpenImage}
          onToggleImageFit={stable.onToggleImageFit}
          onDrawOverImage={stable.onDrawOverImage}
          onOpenFile={stable.onOpenFile}
          onDownloadFile={stable.onDownloadFile}
          onOpenFileDatabase={stable.onOpenFileDatabase}
          onOpenLink={stable.onOpenLink}
          onOpenLinkDatabase={stable.onOpenLinkDatabase}
          // Present or not as the screen says; stable while present.
          onTimecode={onTimecode ? stable.onTimecode : undefined}
          onNoteLink={onNoteLink ? stable.onNoteLink : undefined}
          onNoteLinkMenu={onNoteLinkMenu ? stable.onNoteLinkMenu : undefined}
          isNestedLink={isNestedLink ? stable.isNestedLink : undefined}
          onOpenSketch={stable.onOpenSketch}
          allTags={allTags}
          onOpenCustomRow={stable.onOpenCustomRow}
          documentIndex={documentIndex}
          onOpenDocument={onOpenDocument ? stable.onOpenDocument : undefined}
          onOpenCustomView={stable.onOpenCustomView}
          softInputDisabled={softInputDisabled}
          inputRef={rowFns(item.id).inputRef}
          paperColor={paperColor}
        />
        );
      })}

      {((draggingIds && insertIndex !== null) || externalIndex !== null) && (
        <Animated.View pointerEvents="none" style={[styles.dropLine, dropLineStyle]} />
      )}
    </View>
  );
}

export default forwardRef(BlockList);
