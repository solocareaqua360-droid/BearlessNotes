import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  LayoutAnimation,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// react-native-gesture-handler's own ScrollView (not the core RN one) so it
// shares the same touch arena as our rows' Pan gestures - otherwise a swipe
// starting on a block (its TextInput especially) never reaches the
// ScrollView's own scroll recognition and only the icon column can scroll.
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Block } from '../types';
import { RootStackParamList } from '../navigation';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';
const AUTOSAVE_DELAY_MS = 600;
const DRAG_LONG_PRESS_MS = 350;

function newBlock(): Block {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, text: '' };
}

// Content of a single block: a leading icon (a drag handle normally, or a
// checkbox while select mode is on) and the text field. Dragging is handled
// by the wrapping SortableBlockRow below, not in here.
type BlockRowProps = {
  item: Block;
  isSelected: boolean;
  isSelectMode: boolean;
  isEditMode: boolean;
  showBoundary: boolean;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onFocus: (id: string) => void;
  inputRef: (ref: TextInput | null) => void;
};

function BlockRow({
  item,
  isSelected,
  isSelectMode,
  isEditMode,
  showBoundary,
  onChangeText,
  onBackspaceEmpty,
  onToggleSelected,
  onFocus,
  inputRef,
}: BlockRowProps) {
  // Outside edit mode (or while selecting), the text field is completely
  // inert to touch (pointerEvents: 'none') rather than merely
  // non-editable - a TextInput that can still receive touches keeps
  // claiming them for cursor placement even when non-editable, which is
  // exactly what was blocking swipe-to-scroll over blocks. With no
  // TextInput to compete with, a swipe anywhere reaches the ScrollView
  // just like it already did over the icon column.
  const canEditText = isEditMode && !isSelectMode;

  return (
    <View
      style={[styles.blockRow, isSelected && styles.blockRowSelected, showBoundary && styles.blockRowBoundary]}
    >
      <TextInput
        // Android's TextInput doesn't reliably pick up a dynamic `editable`
        // change on an already-mounted view; keying on canEditText forces a
        // clean remount so the native EditText is created with the correct
        // editable/pointerEvents state instead of getting stuck non-editable.
        key={canEditText ? 'editable' : 'locked'}
        ref={inputRef}
        value={item.text}
        editable={canEditText}
        pointerEvents={canEditText ? 'auto' : 'none'}
        onChangeText={(text) => onChangeText(item.id, text)}
        onFocus={() => onFocus(item.id)}
        onKeyPress={({ nativeEvent }) => {
          if (nativeEvent.key === 'Backspace' && item.text === '') {
            onBackspaceEmpty(item.id);
          }
        }}
        placeholder="Пишіть тут…"
        style={styles.blockInput}
        multiline
      />
      {/* On the right, under the header's select-mode toggle (also on the
          right) so the two read as one control. */}
      <Pressable
        hitSlop={8}
        disabled={!isSelectMode}
        onPress={() => onToggleSelected(item.id)}
        style={styles.dragHandle}
      >
        <Ionicons
          name={isSelectMode ? (isSelected ? 'checkbox' : 'square-outline') : 'reorder-two-outline'}
          size={isSelectMode ? 26 : 20}
          color={isSelected ? ACCENT : '#9CA3AF'}
        />
      </Pressable>
    </View>
  );
}

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
type SortableBlockRowProps = {
  item: Block;
  isSelected: boolean;
  isSelectMode: boolean;
  isEditMode: boolean;
  isDragging: boolean;
  isDragActive: boolean;
  compressTowardOffset: number;
  onLayout: (e: LayoutChangeEvent) => void;
  onDragStart: () => void;
  onDragUpdate: (translationY: number) => void;
  onDragEnd: () => void;
  onToggleSelected: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  onFocus: (id: string) => void;
  inputRef: (ref: TextInput | null) => void;
};

function SortableBlockRow({
  item,
  isSelected,
  isSelectMode,
  isEditMode,
  isDragging,
  isDragActive,
  compressTowardOffset,
  onLayout,
  onDragStart,
  onDragUpdate,
  onDragEnd,
  onToggleSelected,
  onChangeText,
  onBackspaceEmpty,
  onFocus,
  inputRef,
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
  // operates below React Native's own pointerEvents, so it has to be left
  // out of the composition entirely outside edit mode - otherwise it keeps
  // deferring to the text field's native touch handling even though that
  // field is pointerEvents: 'none', which is exactly what was still
  // blocking the ScrollView from ever seeing a swipe over a block.
  const canEditText = isEditMode && !isSelectMode;
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
    opacity: 1 - compress.value * 0.65,
    transform: [
      { translateY: compressTowardOffset * compress.value },
      { scaleY: 1 - compress.value * 0.8 },
    ],
  }));

  return (
    <View onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={compressStyle}>
          <BlockRow
            item={item}
            isSelected={isSelected}
            isSelectMode={isSelectMode}
            isEditMode={isEditMode}
            showBoundary={isDragActive}
            onChangeText={onChangeText}
            onBackspaceEmpty={onBackspaceEmpty}
            onToggleSelected={onToggleSelected}
            onFocus={onFocus}
            inputRef={inputRef}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
type BlockListProps = {
  blocks: Block[];
  onReorder: (blocks: Block[]) => void;
  selectedIds: Set<string>;
  isSelectMode: boolean;
  isEditMode: boolean;
  onToggleSelected: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  onFocus: (id: string) => void;
  onInputRef: (id: string, ref: TextInput | null) => void;
};

function BlockList({
  blocks,
  onReorder,
  selectedIds,
  isSelectMode,
  isEditMode,
  onToggleSelected,
  onChangeText,
  onBackspaceEmpty,
  onFocus,
  onInputRef,
}: BlockListProps) {
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

  return (
    <View style={styles.blockListContainer}>
      {blocks.map((item) => (
        <SortableBlockRow
          key={item.id}
          item={item}
          isSelected={selectedIds.has(item.id)}
          isSelectMode={isSelectMode}
          isEditMode={isEditMode}
          isDragging={draggingIds?.includes(item.id) ?? false}
          isDragActive={draggingIds !== null}
          compressTowardOffset={compressOffsetFor(item.id)}
          onLayout={(e) => handleRowLayout(item.id, e)}
          onDragStart={() => handleDragStart(item.id, dragGroupFor(item.id))}
          onDragUpdate={(translationY) =>
            handleDragUpdate(item.id, dragGroupFor(item.id), translationY)
          }
          onDragEnd={() => handleDragEnd(dragGroupFor(item.id))}
          onToggleSelected={onToggleSelected}
          onChangeText={onChangeText}
          onBackspaceEmpty={onBackspaceEmpty}
          onFocus={onFocus}
          inputRef={(ref) => onInputRef(item.id, ref)}
        />
      ))}

      {draggingIds && insertIndex !== null && (
        <Animated.View pointerEvents="none" style={[styles.dropLine, dropLineStyle]} />
      )}
    </View>
  );
}

type Props = NativeStackScreenProps<RootStackParamList, 'Editor'>;

export default function DocumentEditorScreen({ route, navigation }: Props) {
  const { documentId } = route.params;
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const focusIdRef = useRef<string | null>(null);
  const focusToEndRef = useRef(false);
  const focusedBlockIdRef = useRef<string | null>(null);
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const undoStackRef = useRef<{ title: string; blocks: Block[] }[]>([]);
  const redoStackRef = useRef<{ title: string; blocks: Block[] }[]>([]);
  const isTypingBurstRef = useRef(false);
  const typingBurstTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const snapshot = await getDoc(doc(db, 'documents', documentId));
      const data = snapshot.data();
      setTitle(data?.title ?? '');
      const loadedBlocks: Block[] = data?.blocks ?? [];
      setBlocks(loadedBlocks.length > 0 ? loadedBlocks : [newBlock()]);
      setIsLoaded(true);
    })();
  }, [documentId]);

  useEffect(() => {
    if (!isLoaded) return;
    setSaveStatus('saving');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      updateDoc(doc(db, 'documents', documentId), {
        title,
        blocks,
        updatedAt: Date.now(),
      }).then(() => setSaveStatus('saved'));
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, blocks, isLoaded]);

  useEffect(() => {
    const id = focusIdRef.current;
    if (!id) return;
    const input = inputRefs.current[id];
    input?.focus();
    if (focusToEndRef.current) {
      const block = blocks.find((b) => b.id === id);
      if (block) {
        input?.setSelection(block.text.length, block.text.length);
      }
      focusToEndRef.current = false;
    }
    focusIdRef.current = null;
  }, [blocks]);

  // Expo Go's own manifest isn't affected by app.json's
  // android.softwareKeyboardLayoutMode, so the keyboard never resizes the
  // window here the way a real build's adjustResize would - the screen has
  // to track the keyboard itself and scroll the focused block above it.
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      scheduleScrollAdjust(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
      if (scrollAdjustTimeoutRef.current) clearTimeout(scrollAdjustTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Moving focus between blocks (e.g. Enter creating a new one) can fire
  // keyboardDidShow again even though the keyboard never really left the
  // screen, and the new block's own layout hasn't settled yet at the exact
  // moment it's focused. Debouncing collapses those into a single
  // measurement taken once things are quiet, instead of an early (wrong)
  // scroll immediately followed by a corrective one - the visible
  // "jumps up then down" the user saw.
  const scrollAdjustTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleScrollAdjust(currentKeyboardHeight: number) {
    if (scrollAdjustTimeoutRef.current) clearTimeout(scrollAdjustTimeoutRef.current);
    scrollAdjustTimeoutRef.current = setTimeout(() => {
      scrollFocusedBlockIntoView(currentKeyboardHeight);
    }, 60);
  }

  function scrollFocusedBlockIntoView(currentKeyboardHeight: number) {
    const id = focusedBlockIdRef.current;
    const input = id ? inputRefs.current[id] : null;
    if (!input) return;
    input.measure((_x, _y, _width, height, _pageX, pageY) => {
      const visibleBottom = Dimensions.get('window').height - currentKeyboardHeight;
      const overflow = pageY + height - visibleBottom + 24;
      if (overflow > 0) {
        scrollViewRef.current?.scrollTo({ y: scrollOffsetRef.current + overflow, animated: true });
      }
    });
  }

  function handleBlockFocus(id: string) {
    focusedBlockIdRef.current = id;
    if (keyboardHeight > 0) {
      scheduleScrollAdjust(keyboardHeight);
    }
  }

  const UNDO_HISTORY_LIMIT = 50;
  const TYPING_BURST_MS = 800;

  // Captures the state as it was right BEFORE a discrete, structural
  // change (add/delete/reorder a block) - each of these is its own undo
  // step. Also ends any in-progress typing burst, so unrelated typing
  // before and after a structural edit never gets merged into one step.
  function snapshotBeforeChange() {
    undoStackRef.current.push({ title, blocks });
    if (undoStackRef.current.length > UNDO_HISTORY_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
    isTypingBurstRef.current = false;
    setCanUndo(true);
    setCanRedo(false);
  }

  // Typing a whole sentence one keystroke at a time shouldn't be one undo
  // step per character - only the FIRST change since the last pause gets
  // snapshotted; a timer marks the burst over after a short quiet spell,
  // so the next keystroke (in this block or another) starts a fresh one.
  function snapshotForTyping() {
    if (!isTypingBurstRef.current) {
      snapshotBeforeChange();
      isTypingBurstRef.current = true;
    }
    if (typingBurstTimeoutRef.current) clearTimeout(typingBurstTimeoutRef.current);
    typingBurstTimeoutRef.current = setTimeout(() => {
      isTypingBurstRef.current = false;
    }, TYPING_BURST_MS);
  }

  function undo() {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push({ title, blocks });
    isTypingBurstRef.current = false;
    setTitle(previous.title);
    setBlocks(previous.blocks);
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
  }

  function redo() {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push({ title, blocks });
    isTypingBurstRef.current = false;
    setTitle(next.title);
    setBlocks(next.blocks);
    setCanRedo(redoStackRef.current.length > 0);
    setCanUndo(true);
  }

  function handleTitleChange(text: string) {
    snapshotForTyping();
    setTitle(text);
  }

  function handleBlockChange(id: string, text: string) {
    snapshotForTyping();
    // React Native's TextInput never reports whether Shift was held for
    // Enter (Android's own bridge code discards that before it reaches JS,
    // on any keyboard, soft or hardware) - so a single Enter has to just be
    // a line break within the block, and creating a new block instead needs
    // its own distinct signal: pressing Enter again on the resulting empty
    // line, i.e. two consecutive newlines.
    const doubleNewlineIndex = text.indexOf('\n\n');
    if (doubleNewlineIndex === -1) {
      setBlocks((prev) => prev.map((block) => (block.id === id ? { ...block, text } : block)));
      return;
    }
    // Both newlines are consumed here - the blank line the first Enter left
    // behind shouldn't linger in either block.
    const before = text.slice(0, doubleNewlineIndex);
    const after = text.slice(doubleNewlineIndex + 2);
    const created: Block = { ...newBlock(), text: after };
    focusIdRef.current = created.id;
    setBlocks((prev) => {
      const index = prev.findIndex((block) => block.id === id);
      const next = [...prev];
      next[index] = { ...next[index], text: before };
      next.splice(index + 1, 0, created);
      return next;
    });
  }

  function handleBackspaceOnEmpty(id: string) {
    const index = blocks.findIndex((block) => block.id === id);
    if (index <= 0) return;
    snapshotBeforeChange();
    setBlocks((prev) => {
      const prevIndex = prev.findIndex((block) => block.id === id);
      if (prevIndex <= 0) return prev;
      const previous = prev[prevIndex - 1];
      focusIdRef.current = previous.id;
      focusToEndRef.current = true;
      const next = [...prev];
      next.splice(prevIndex, 1);
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function deleteSelectedBlocks() {
    snapshotBeforeChange();
    setBlocks((prev) => {
      const next = prev.filter((block) => !selectedIds.has(block.id));
      return next.length > 0 ? next : [newBlock()];
    });
    setSelectedIds(new Set());
    setIsSelectMode(false);
  }

  function toggleSelectMode() {
    setIsSelectMode((prev) => !prev);
    setSelectedIds(new Set());
  }

  // Outside edit mode a block's TextInput is pointerEvents: 'none' (see
  // BlockRow) so scrolling can reach through it - which means there's no
  // per-block tap to "start editing here"; the pencil button is the only
  // way in, and it always resumes at the end of the last block, cursor and
  // all, like continuing a line you were already writing.
  function toggleEditMode() {
    if (isEditMode) {
      Keyboard.dismiss();
      setIsEditMode(false);
      return;
    }
    setIsEditMode(true);
    if (blocks.length === 0) return;
    const last = blocks[blocks.length - 1];
    requestAnimationFrame(() => {
      const input = inputRefs.current[last.id];
      input?.focus();
      input?.setSelection(last.text.length, last.text.length);
    });
  }

  function addBlockAtEnd() {
    snapshotBeforeChange();
    const created = newBlock();
    focusIdRef.current = created.id;
    setIsEditMode(true);
    setBlocks((prev) => [...prev, created]);
  }

  function handleReorderBlocks(next: Block[]) {
    snapshotBeforeChange();
    setBlocks(next);
  }

  if (!isLoaded) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </Pressable>
          <Pressable hitSlop={8} onPress={undo} disabled={!canUndo}>
            <Ionicons name="arrow-undo-outline" size={22} color={canUndo ? '#111827' : '#D1D5DB'} />
          </Pressable>
          <Pressable hitSlop={8} onPress={redo} disabled={!canRedo}>
            <Ionicons name="arrow-redo-outline" size={22} color={canRedo ? '#111827' : '#D1D5DB'} />
          </Pressable>
        </View>
        <Text style={styles.headerStatus}>
          {saveStatus === 'saving' ? 'Збереження…' : 'Збережено'}
        </Text>
        <View style={styles.headerRight}>
          <Pressable hitSlop={8} onPress={toggleEditMode}>
            <Ionicons
              name={isEditMode ? 'checkmark-outline' : 'create-outline'}
              size={22}
              color={isEditMode ? ACCENT : '#111827'}
            />
          </Pressable>
          <Pressable hitSlop={8} onPress={toggleSelectMode}>
            <Ionicons
              name={isSelectMode ? 'close' : 'ellipse-outline'}
              size={22}
              color="#111827"
            />
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollArea}
        contentContainerStyle={{ paddingBottom: keyboardHeight + 40 }}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        <TextInput
          key={isEditMode ? 'editable' : 'locked'}
          value={title}
          onChangeText={handleTitleChange}
          editable={isEditMode}
          pointerEvents={isEditMode ? 'auto' : 'none'}
          placeholder="Без назви"
          style={styles.titleInput}
        />

        <BlockList
          blocks={blocks}
          onReorder={handleReorderBlocks}
          selectedIds={selectedIds}
          isSelectMode={isSelectMode}
          isEditMode={isEditMode}
          onToggleSelected={toggleSelected}
          onChangeText={handleBlockChange}
          onBackspaceEmpty={handleBackspaceOnEmpty}
          onFocus={handleBlockFocus}
          onInputRef={(id, ref) => {
            inputRefs.current[id] = ref;
          }}
        />

        {selectedIds.size > 0 ? (
          <Pressable style={styles.deleteSelected} onPress={deleteSelectedBlocks}>
            <Ionicons name="trash-outline" size={18} color={DANGER} />
            <Text style={styles.deleteSelectedLabel}>Видалити ({selectedIds.size})</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.addBlock} onPress={addBlockAtEnd}>
            <Ionicons name="add" size={18} color={ACCENT} />
            <Text style={styles.addBlockLabel}>Додати блок</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
  },
  headerStatus: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  scrollArea: {
    flex: 1,
  },
  titleInput: {
    fontSize: 24,
    fontWeight: '600',
    color: '#111827',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  blockListContainer: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: '#fff',
  },
  blockRowSelected: {
    backgroundColor: '#EFF6FF',
  },
  blockRowBoundary: {
    borderColor: '#E5E7EB',
  },
  dragHandle: {
    padding: 6,
  },
  blockInput: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  dropLine: {
    position: 'absolute',
    top: 0,
    left: 8,
    right: 8,
    height: 4,
    borderRadius: 2,
    backgroundColor: ACCENT,
  },
  addBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  addBlockLabel: {
    fontSize: 15,
    color: ACCENT,
  },
  deleteSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  deleteSelectedLabel: {
    fontSize: 15,
    color: DANGER,
  },
});
