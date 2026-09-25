import { useEffect } from 'react';
import { LayoutChangeEvent, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
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
  textVersion: number;
  onLayout: (e: LayoutChangeEvent) => void;
  onDragStart: () => void;
  onDragUpdate: (translationY: number) => void;
  onDragEnd: () => void;
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
};

// Long enough that a deliberate press-and-hold reads clearly apart from a
// tap - a tap on a block now starts editing it (see BlockRow), so the two
// can't be allowed to blur into each other.
const DRAG_LONG_PRESS_MS = 500;

export default function SortableBlockRow({
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
  textVersion,
  hideHandle,
  searchHighlight,
  indented,
  onLayout,
  onDragStart,
  onDragUpdate,
  onDragEnd,
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
  documentIndex,
  onOpenDocument,
  onOpenCustomView,
  inputRef,
  softInputDisabled,
  paperColor,
}: SortableBlockRowProps) {
  // This gesture's whole job is JS-side (finding the nearest gap, updating
  // React state) - there's no per-frame UI-thread animation to protect
  // here, so it runs plainly on the JS thread instead of being wrapped in
  // worklet/runOnJS ceremony for no benefit.
  const dragGesture = Gesture.Pan()
    .activateAfterLongPress(DRAG_LONG_PRESS_MS)
    .runOnJS(true)
    .onStart(() => onDragStart())
    .onUpdate((e) => onDragUpdate(e.translationY))
    .onEnd(() => onDragEnd());

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
  const gesture = canEditText ? Gesture.Simultaneous(dragGesture, Gesture.Native()) : dragGesture;

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
      { translateY: compressTowardOffset * compress.value },
      // Shrinks evenly on every side rather than flattening vertically -
      // a picked-up card reads as "lifted away", where the old scaleY-only
      // squash made an image block look like it was being crushed.
      { scale: 1 - compress.value * 0.3 },
    ],
  }));

  return (
    <View onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={compressStyle}>
          <BlockRow
            item={item}
            hideHandle={hideHandle}
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
    </View>
  );
}
