import { useRef, useState } from 'react';
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

export default function BlockList({
  blocks,
  onReorder,
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
}: BlockListProps) {
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

  function setInsertIndex(index: number | null) {
    insertIndexRef.current = index;
    setInsertIndexState(index);
  }

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

  function handleDragEnd(ids: string[]) {
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
    <View style={styles.blockListContainer}>
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
          onDragEnd={() => handleDragEnd(dragGroupFor(item.id))}
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

      {draggingIds && insertIndex !== null && (
        <Animated.View pointerEvents="none" style={[styles.dropLine, dropLineStyle]} />
      )}
    </View>
  );
}
