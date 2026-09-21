import { ForwardedRef, forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { LayoutAnimation, LayoutChangeEvent, TextInput, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Block, Tag } from '../types';
import { useStyles } from '../theme/ThemeProvider';
import { makeStyles } from './documentEditorStyles';
import type { colorForDocument } from '../utils/documentColor';
import { hapticDrop, hapticPickUp, hapticSnapTick } from '../utils/haptics';
import SortableBlockRow from './SortableBlockRow';

// Pulled out of DocumentEditorScreen.tsx (2026-09-19) alongside BlockRow/
// SortableBlockRow - a plain, prop-only component.
type BlockListProps = {
  // Passed straight through to every row - see BlockRow's own hideHandle.
  hideHandle?: boolean;
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
  onOpenSketch: (id: string) => void;
  // 'dbRow' blocks only - the full tag list (the card filters it by the
  // live row's own tagIds) and "open this row in its database".
  allTags: Tag[];
  onOpenCustomRow: (databaseId: string, rowId: string) => void;
  // 'dbView' blocks only - "open this view's own database, with that view
  // applied" (tapping the block's header, as opposed to one of its rows).
  onOpenCustomView: (databaseId: string, viewId: string) => void;
  onInputRef: (id: string, ref: TextInput | null) => void;
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
};

const NOTHING_DRAGGING: Set<string> = new Set();

// The mid-drag snap, same as a block being reordered uses - see
// handleDragUpdate on why it clamps the overshoot.
const DROP_LINE_SPRING = { damping: 26, stiffness: 260, overshootClamping: true };

function BlockList({
  blocks,
  onReorder,
  onHoldWithoutDrag,
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
  onOpenSketch,
  allTags,
  onOpenCustomRow,
  onOpenCustomView,
  onInputRef,
  paperColor,
  hideHandle,
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

  return (
    <View ref={containerRef} collapsable={false} style={styles.blockListContainer}>
      {blocks.map((item, index) => {
        if (item.type === 'numbered') {
          runningNumber = index > 0 && blocks[index - 1].type === 'numbered' ? runningNumber + 1 : 1;
        } else {
          runningNumber = 0;
        }
        return (
        <SortableBlockRow
          key={item.id}
          item={item}
          hideHandle={hideHandle}
          isSelected={selectedIds.has(item.id)}
          isSelectMode={isSelectMode}
          isActive={focusedBlockId === item.id}
          onActivate={onActivate}
          onBlur={onBlur}
          isDragging={draggingIds?.includes(item.id) ?? false}
          isDragActive={draggingIds !== null}
          listNumber={item.type === 'numbered' ? runningNumber : undefined}
          textVersion={textVersions[item.id] ?? 0}
          compressTowardOffset={compressOffsetFor(item.id)}
          onLayout={(e) => handleRowLayout(item.id, e)}
          onDragStart={() => handleDragStart(item.id, dragGroupFor(item.id))}
          onDragUpdate={(translationY) =>
            handleDragUpdate(item.id, dragGroupFor(item.id), translationY)
          }
          onDragEnd={() => handleDragEnd(item.id, dragGroupFor(item.id))}
          onToggleSelected={onToggleSelected}
          onToggleChecked={onToggleChecked}
          onOpenReminder={onOpenReminder}
          onUpdateBlock={onUpdateBlock}
          onChangeText={onChangeText}
          onBackspaceEmpty={onBackspaceEmpty}
          onFocus={onFocus}
          onSelectionChange={onSelectionChange}
          onOpenImage={onOpenImage}
          onToggleImageFit={onToggleImageFit}
          onDrawOverImage={onDrawOverImage}
          onOpenFile={onOpenFile}
          onDownloadFile={onDownloadFile}
          onOpenFileDatabase={onOpenFileDatabase}
          onOpenLink={onOpenLink}
          onOpenLinkDatabase={onOpenLinkDatabase}
          onOpenSketch={onOpenSketch}
          allTags={allTags}
          onOpenCustomRow={onOpenCustomRow}
          onOpenCustomView={onOpenCustomView}
          inputRef={(ref) => onInputRef(item.id, ref)}
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
