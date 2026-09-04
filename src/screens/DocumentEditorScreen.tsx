import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
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
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  onToggleSelected: (id: string) => void;
  inputRef: (ref: TextInput | null) => void;
};

function BlockRow({
  item,
  isSelected,
  isSelectMode,
  onChangeText,
  onBackspaceEmpty,
  onToggleSelected,
  inputRef,
}: BlockRowProps) {
  return (
    <View style={[styles.blockRow, isSelected && styles.blockRowSelected]}>
      <Pressable
        hitSlop={8}
        disabled={!isSelectMode}
        onPress={() => onToggleSelected(item.id)}
        style={styles.dragHandle}
      >
        <Ionicons
          name={isSelectMode ? (isSelected ? 'checkbox' : 'square-outline') : 'reorder-two-outline'}
          size={20}
          color={isSelected ? ACCENT : '#9CA3AF'}
        />
      </Pressable>
      <TextInput
        ref={inputRef}
        value={item.text}
        onChangeText={(text) => onChangeText(item.id, text)}
        onKeyPress={({ nativeEvent }) => {
          if (nativeEvent.key === 'Backspace' && item.text === '') {
            onBackspaceEmpty(item.id);
          }
        }}
        placeholder="Пишіть тут…"
        style={styles.blockInput}
        multiline
      />
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
  isDragging: boolean;
  onLayout: (e: LayoutChangeEvent) => void;
  onDragStart: () => void;
  onDragUpdate: (translationY: number) => void;
  onDragEnd: () => void;
  onToggleSelected: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  inputRef: (ref: TextInput | null) => void;
};

function SortableBlockRow({
  item,
  isSelected,
  isSelectMode,
  isDragging,
  onLayout,
  onDragStart,
  onDragUpdate,
  onDragEnd,
  onToggleSelected,
  onChangeText,
  onBackspaceEmpty,
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
  // instead of waiting for one to fail before trying the other.
  const gesture = Gesture.Simultaneous(dragGesture, Gesture.Native());

  return (
    <View onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <View style={{ opacity: isDragging ? 0.5 : 1 }}>
          <BlockRow
            item={item}
            isSelected={isSelected}
            isSelectMode={isSelectMode}
            onChangeText={onChangeText}
            onBackspaceEmpty={onBackspaceEmpty}
            onToggleSelected={onToggleSelected}
            inputRef={inputRef}
          />
        </View>
      </GestureDetector>
    </View>
  );
}
type BlockListProps = {
  blocks: Block[];
  onReorder: (blocks: Block[]) => void;
  selectedIds: Set<string>;
  isSelectMode: boolean;
  onToggleSelected: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  onInputRef: (id: string, ref: TextInput | null) => void;
};

function BlockList({
  blocks,
  onReorder,
  selectedIds,
  isSelectMode,
  onToggleSelected,
  onChangeText,
  onBackspaceEmpty,
  onInputRef,
}: BlockListProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [insertIndex, setInsertIndexState] = useState<number | null>(null);
  const insertIndexRef = useRef<number | null>(null);
  const dropLineY = useSharedValue(0);
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

  // Y position of the "gap" before the block currently at `index` (or after
  // the last block, if index is past the end) - where the drop-line sits.
  function gapYFor(index: number): number {
    const list = blocksRef.current;
    if (list.length === 0) return 0;
    if (index <= 0) return rowLayouts.current[list[0].id]?.y ?? 0;
    if (index >= list.length) {
      const last = list[list.length - 1];
      const rl = rowLayouts.current[last.id];
      return rl ? rl.y + rl.height : 0;
    }
    return rowLayouts.current[list[index].id]?.y ?? 0;
  }

  // How many blocks (including the dragged one, at its original spot) have
  // their midpoint above this Y - i.e. where the dragged block would land
  // if dropped now, counted against the list as it currently sits (nothing
  // is actually reordered until the gesture ends).
  function computeInsertIndex(currentY: number): number {
    const list = blocksRef.current;
    let index = 0;
    for (let i = 0; i < list.length; i++) {
      const rl = rowLayouts.current[list[i].id];
      if (!rl) continue;
      if (currentY > rl.y + rl.height / 2) {
        index = i + 1;
      }
    }
    return index;
  }

  function handleDragStart(id: string) {
    setDraggingId(id);
    const layout = rowLayouts.current[id];
    const list = blocksRef.current;
    const currentIndex = list.findIndex((b) => b.id === id);
    setInsertIndex(currentIndex);
    if (layout) {
      dropLineY.value = gapYFor(currentIndex);
    }
  }

  function handleDragUpdate(id: string, translationY: number) {
    const layout = rowLayouts.current[id];
    if (!layout) return;
    const currentY = layout.y + translationY + layout.height / 2;
    const targetIndex = computeInsertIndex(currentY);
    if (targetIndex !== insertIndexRef.current) {
      setInsertIndex(targetIndex);
      dropLineY.value = withSpring(gapYFor(targetIndex), { damping: 22, stiffness: 220 });
    }
  }

  function handleDragEnd(id: string) {
    const targetIndex = insertIndexRef.current;
    const list = blocksRef.current;
    const currentIndex = list.findIndex((b) => b.id === id);
    if (targetIndex !== null && currentIndex !== -1) {
      // targetIndex was computed against the list with the dragged item
      // still in its original slot, so inserting after that slot needs a
      // -1 adjustment once the item is actually removed from it.
      const spliceIndex = targetIndex > currentIndex ? targetIndex - 1 : targetIndex;
      if (spliceIndex !== currentIndex) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        const next = [...list];
        const [moved] = next.splice(currentIndex, 1);
        next.splice(spliceIndex, 0, moved);
        onReorder(next);
      }
    }
    setDraggingId(null);
    setInsertIndex(null);
  }

  const dropLineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dropLineY.value - 2 }],
  }));

  return (
    <View style={styles.blockListContainer}>
      {blocks.map((item) => (
        <SortableBlockRow
          key={item.id}
          item={item}
          isSelected={selectedIds.has(item.id)}
          isSelectMode={isSelectMode}
          isDragging={draggingId === item.id}
          onLayout={(e) => handleRowLayout(item.id, e)}
          onDragStart={() => handleDragStart(item.id)}
          onDragUpdate={(translationY) => handleDragUpdate(item.id, translationY)}
          onDragEnd={() => handleDragEnd(item.id)}
          onToggleSelected={onToggleSelected}
          onChangeText={onChangeText}
          onBackspaceEmpty={onBackspaceEmpty}
          inputRef={(ref) => onInputRef(item.id, ref)}
        />
      ))}

      {draggingId && insertIndex !== null && (
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
  const focusIdRef = useRef<string | null>(null);
  const focusToEndRef = useRef(false);
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  function handleBlockChange(id: string, text: string) {
    const newlineIndex = text.indexOf('\n');
    if (newlineIndex === -1) {
      setBlocks((prev) => prev.map((block) => (block.id === id ? { ...block, text } : block)));
      return;
    }
    // Enter inserts a literal newline into a multiline TextInput; treat it as
    // "split into a new block" instead of letting the newline stay in the text.
    const before = text.slice(0, newlineIndex);
    const after = text.slice(newlineIndex + 1);
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
    setBlocks((prev) => {
      const index = prev.findIndex((block) => block.id === id);
      if (index <= 0) return prev;
      const previous = prev[index - 1];
      focusIdRef.current = previous.id;
      focusToEndRef.current = true;
      const next = [...prev];
      next.splice(index, 1);
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

  function addBlockAtEnd() {
    const created = newBlock();
    focusIdRef.current = created.id;
    setBlocks((prev) => [...prev, created]);
  }

  if (!isLoaded) {
    return <View style={styles.container} />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.header}>
        <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </Pressable>
        <Text style={styles.headerStatus}>
          {saveStatus === 'saving' ? 'Збереження…' : 'Збережено'}
        </Text>
        <Pressable hitSlop={8} onPress={toggleSelectMode}>
          <Ionicons
            name={isSelectMode ? 'close' : 'checkmark-circle-outline'}
            size={22}
            color="#111827"
          />
        </Pressable>
      </View>

      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Без назви"
        style={styles.titleInput}
      />

      <Text style={styles.debugCount}>ДІАГНОСТИКА: блоків у стані = {blocks.length}</Text>

      <BlockList
        blocks={blocks}
        onReorder={setBlocks}
        selectedIds={selectedIds}
        isSelectMode={isSelectMode}
        onToggleSelected={toggleSelected}
        onChangeText={handleBlockChange}
        onBackspaceEmpty={handleBackspaceOnEmpty}
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
    </KeyboardAvoidingView>
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
  debugCount: {
    fontSize: 13,
    color: '#fff',
    backgroundColor: DANGER,
    paddingHorizontal: 20,
    paddingVertical: 4,
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
    backgroundColor: '#fff',
  },
  blockRowSelected: {
    backgroundColor: '#EFF6FF',
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
