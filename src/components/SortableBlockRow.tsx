import { memo, useEffect } from 'react';
import { useDensity } from '../hooks/useDensity';
import { LayoutChangeEvent, StyleSheet, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Block, Tag } from '../types';
import type { colorForDocument } from '../utils/documentColor';
import BlockRow from './BlockRow';
import type { DocumentIndex } from '../hooks/useDocumentIndex';

// react-native-draggable-flatlist AND react-native-swipeable-item both
// have the same underlying assumption: they render their content inside a
// `flex: 1` view expecting a parent with an already-known fixed height
// (like a standard FlatList row). Our blocks have variable-height text, so
// nothing here ever gives them that fixed height, and `flex: 1` inside an
// auto-height parent collapses to 0 - blocks existed in state but were
// invisible. So drag-to-reorder is hand-built directly on gesture-handler:
// a plain View per block (no virtualization, fine for a single document's
// block count), each row's position measured via onLayout, and a
// long-press-then-pan gesture. The dragged row itself never moves during
// the gesture (and the array isn't touched until release) - only a thin
// "drop line" indicator (rendered by the parent BlockList) snaps between
// rows to show where it will land, which is what actually feels smooth,
// instead of live-reordering + re-animating the whole list on every frame.
//
// Pulled out of DocumentEditorScreen.tsx (2026-09-19) alongside BlockRow -
// a plain, prop-only component, no closure over the screen's own state.
type SortableBlockRowProps = {
  item: Block;
  hideHandle?: boolean;
  searchHighlight?: string;
  // Under a toggle's section - see BlockList's own indented computation
  // and BlockRow, which is the one place this actually draws anything.
  indented?: boolean;
  isSelected: boolean;
  isSelectMode: boolean;
  isActive: boolean;
  // cursorIndex: DISPLAY-text position to place the cursor at (from a tap on
  // the locked text); omitted = end of the text.
  onActivate: (id: string, cursorIndex?: number) => void;
  onBlur: (id: string) => void;
  isDragging: boolean;
  isDragActive: boolean;
  compressTowardOffset: number;
  listNumber?: number;
  // The toggle frame this row belongs to, and a closed toggle's faint first line (BlockList computes both).
  toggleRole?: 'solo' | 'head' | 'body' | 'foot';
  foldHint?: string;
  textVersion: number;
  onLayout: (e: LayoutChangeEvent) => void;
  onDragStart: () => void;
  onDragUpdate: (translationY: number) => void;
  onDragEnd: () => void;
  // At a pointer: a click on the handle, without a drag.
  onHandleClick?: () => void;
  // Swipe to select (see BlockList's sweep): on where the screen asks for it.
  swipeSelect?: boolean;
  onSweepStart?: () => void;
  onSweepUpdate?: (absoluteY: number, translationY: number) => void;
  onSweepEnd?: () => void;
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
  // Straight through to BlockRow, for a 'docRef' row.
  documentIndex?: DocumentIndex;
  onOpenDocument?: (documentId: string) => void;
  // 'dbView' blocks only - "open this view's own database, with that view
  // applied" (tapping the block's header, as opposed to one of its rows).
  onOpenCustomView: (databaseId: string, viewId: string) => void;
  inputRef: (ref: TextInput | null) => void;
  softInputDisabled?: boolean;
  // Attached to the one active row only, so the screen's keyboard handler
  // can measure it on the UI thread the instant the keyboard starts rising.
  paperColor: ReturnType<typeof colorForDocument> | null;
  // Arrived at through a link to this very block: tinted for a moment, so
  // the eye finds it after the scroll.
  flash?: boolean;
};

// Long enough that a deliberate press-and-hold reads clearly apart from a
// tap - a tap on a block now starts editing it (see BlockRow), so the two
// can't be allowed to blur into each other.
const DRAG_LONG_PRESS_MS = 500;
// How far left a finger goes before a swipe picks the block - and how far up or down it may go first before the
// move is the scroll's instead.
const SWIPE_START = 14;
// The swiped block's words follow the finger a little to the left (the user's: «при свайпі сам текст теж повинен
// трохи зміщуватись»), at most this far, and spring back when it lifts.
const NUDGE_MAX = 28;
// In select mode the strip down the right edge, where the ticks stand: a move up or down there picks block after block
// (and the note scrolls along at the edges); the rest of the block keeps its scroll. A few points start it, before the
// note's own scroll can take the move.
const EDGE_W = 56;
const EDGE_START = 4;

function SortableBlockRow({
  item,
  isSelected,
  isSelectMode,
  isActive,
  onActivate,
  onBlur,
  isDragging,
  isDragActive,
  compressTowardOffset,
  listNumber,
  toggleRole,
  foldHint,
  textVersion,
  hideHandle,
  searchHighlight,
  indented,
  onLayout,
  onDragStart,
  onDragUpdate,
  onDragEnd,
  onHandleClick,
  swipeSelect,
  onSweepStart,
  onSweepUpdate,
  onSweepEnd,
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
  inputRef,
  softInputDisabled,
  paperColor,
  flash,
}: SortableBlockRowProps) {
  // At a pointer a block is moved by its handle (shown on hover) at once,
  // not by holding the row for half a second - which is also what a press
  // and a drag across blocks is for (see useBlockMarquee).
  const pointer = useDensity() === 'pointer';
  // This gesture's whole job is JS-side (finding the nearest gap, updating
  // React state) - there's no per-frame UI-thread animation to protect
  // here, so it runs plainly on the JS thread instead of being wrapped in
  // worklet/runOnJS ceremony for no benefit.
  const dragGesture = Gesture.Pan()
    .enabled(!pointer)
    .activateAfterLongPress(DRAG_LONG_PRESS_MS)
    .runOnJS(true)
    .onStart(() => onDragStart())
    .onUpdate((e) => onDragUpdate(e.translationY))
    .onEnd(() => onDragEnd());

  // The handle's: a drag from the first few points, a click without one.
  const handleGesture = pointer
    ? Gesture.Exclusive(
        Gesture.Pan()
          .minDistance(3)
          .runOnJS(true)
          .onStart(() => onDragStart())
          .onUpdate((e) => onDragUpdate(e.translationY))
          .onEnd(() => onDragEnd()),
        Gesture.Tap()
          .runOnJS(true)
          .onEnd(() => onHandleClick?.())
      )
    : undefined;

  // TextInput has its own native touch handling (cursor placement, text
  // selection) that otherwise wins the race for any touch starting on the
  // text itself. Gesture.Native() + Simultaneous tells gesture-handler to
  // let our gesture and the TextInput's own handling run at the same time
  // instead of waiting for one to fail before trying the other. This
  // operates below React Native's own pointerEvents, so it's only composed
  // in for the one active block (the only one that has a TextInput) -
  // for every other block the plain drag gesture is all there is, which
  // is what lets the ScrollView see a swipe over them.
  const canEditText = isActive && !isSelectMode;
  // THE BLOCK BEING WRITTEN IN HAS NO GESTURE OF ITS OWN (2026-10-18, the user: a swipe on it must scroll the note,
  // a tap must place the caret). The Native+drag pair above held every touch that began on the field: the note's
  // ScrollView could never take a swipe over it, so the swipe only dragged the caret. Without it the field's own
  // native rules apply - it gives a vertical move to the scroll (it cannot scroll itself, it grows with its text)
  // and keeps a tap. A hold on the text is the system's own word selection there; the other blocks still move by
  // a hold, and this one does too the moment writing ends.
  // A SWIPE LEFT PICKS (features.swipeSelect, like Craft): it starts only once the finger has gone SWIPE_START to the
  // left, gives up if it went up or down or to the right first (the note's scroll keeps every vertical move), and from
  // then on follows the finger up and down over the other blocks. It races the hold: whichever starts first wins.
  const nudge = useSharedValue(0);
  const sweepGesture = Gesture.Pan()
    .enabled(!pointer && !!swipeSelect)
    .activeOffsetX([-SWIPE_START, 10000])
    .failOffsetX([-10000, SWIPE_START])
    .failOffsetY([-SWIPE_START, SWIPE_START])
    .runOnJS(true)
    .onStart(() => onSweepStart?.())
    .onUpdate((e) => {
      nudge.value = Math.max(-NUDGE_MAX, Math.min(0, e.translationX * 0.35));
      onSweepUpdate?.(e.absoluteY, e.translationY);
    })
    .onFinalize(() => {
      // Straight back, no spring (the user's: «інерційність гіперболізована... звести її до нуля»).
      nudge.value = withTiming(0, { duration: 120 });
      onSweepEnd?.();
    });
  // The tick strip's own: a move up or down picks along, a tap picks this one.
  const edgeGesture = Gesture.Exclusive(
    Gesture.Pan()
      .activeOffsetY([-EDGE_START, EDGE_START])
      .runOnJS(true)
      .onStart(() => onSweepStart?.())
      .onUpdate((e) => onSweepUpdate?.(e.absoluteY, e.translationY))
      .onFinalize(() => onSweepEnd?.()),
    Gesture.Tap()
      .runOnJS(true)
      .onEnd(() => onToggleSelected(item.id))
  );
  // A TABLE THAT IS ONLY SELECTED still answers the left swipe that picks a block (the user, 2026-10-22: the whole table must be pickable
  // without tapping elsewhere first). Its own long press is left to the cells.
  const gesture = canEditText ? (item.type === 'table' ? sweepGesture : Gesture.Pan().enabled(false)) : Gesture.Race(sweepGesture, dragGesture);

  // Every row currently being dragged - whether it's the one lone block or
  // one of several in a multi-select bulk move - eases toward faded and
  // squashed while the gesture is in progress, echoing the "being pulled
  // into the drop line" idea, and eases back once it's released.
  // compressTowardOffset (0 for the anchor itself) also slides each of the
  // OTHER selected rows toward the anchor's center as it shrinks, so a
  // multi-select group visibly converges on the block that was actually
  // long-pressed instead of each row just collapsing into its own middle.
  const compress = useSharedValue(0);
  useEffect(() => {
    compress.value = withTiming(isDragging ? 1 : 0, { duration: 150 });
  }, [isDragging]);
  const compressStyle = useAnimatedStyle(() => ({
    opacity: 1 - compress.value * 0.45,
    transform: [
      { translateX: nudge.value },
      { translateY: compressTowardOffset * compress.value },
      // Shrinks evenly on every side rather than flattening vertically -
      // a picked-up card reads as "lifted away", where the old scaleY-only
      // squash made an image block look like it was being crushed.
      { scale: 1 - compress.value * 0.3 },
    ],
  }));

  // The tint a link's landing leaves: lit at once, held for a second, then
  // faded out slowly rather than switched off.
  const glow = useSharedValue(0);
  useEffect(() => {
    if (!flash) return;
    glow.value = 1;
    glow.value = withDelay(1000, withTiming(0, { duration: 900 }));
  }, [flash]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <View onLayout={onLayout} {...({ dataSet: { blockId: item.id } } as object)}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.glow, glowStyle]} />
      <GestureDetector gesture={gesture}>
        <Animated.View style={compressStyle}>
          <BlockRow
            item={item}
            hideHandle={hideHandle}
            handleGesture={handleGesture}
            searchHighlight={searchHighlight}
            indented={indented}
            isSelected={isSelected}
            isSelectMode={isSelectMode}
            isActive={isActive}
            onActivate={onActivate}
            onBlur={onBlur}
            showBoundary={isDragActive}
            paperColor={paperColor}
            listNumber={listNumber}
            toggleRole={toggleRole}
            foldHint={foldHint}
            textVersion={textVersion}
            onChangeText={onChangeText}
            onBackspaceEmpty={onBackspaceEmpty}
            onToggleSelected={onToggleSelected}
            onToggleChecked={onToggleChecked}
            onOpenReminder={onOpenReminder}
            onUpdateBlock={onUpdateBlock}
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
            onTimecode={onTimecode}
            onNoteLink={onNoteLink}
            onNoteLinkMenu={onNoteLinkMenu}
            isNestedLink={isNestedLink}
            onOpenSketch={onOpenSketch}
            allTags={allTags}
            onOpenCustomRow={onOpenCustomRow}
            documentIndex={documentIndex}
            onOpenDocument={onOpenDocument}
            onOpenCustomView={onOpenCustomView}
            inputRef={inputRef}
            softInputDisabled={softInputDisabled}
          />
        </Animated.View>
      </GestureDetector>
      {isSelectMode && !!swipeSelect && !pointer && (
        <GestureDetector gesture={edgeGesture}>
          <View style={styles.edge} />
        </GestureDetector>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { backgroundColor: 'rgba(37,99,235,0.14)', borderRadius: 12 },
  edge: { position: 'absolute', top: 0, bottom: 0, right: 0, width: EDGE_W },
});

// Re-rendered only when its own props change - BlockList keeps every
// handler it passes stable (see its `stable` and `rowFns`).
export default memo(SortableBlockRow);
