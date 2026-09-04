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
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
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
const SWIPE_SELECT_THRESHOLD = 60;

function newBlock(): Block {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, text: '' };
}

// Content of a single block: title icon (shows a checkmark when selected)
// and the text field. Dragging and swipe-to-select are both handled by the
// wrapping SortableBlockRow below, not in here.
type BlockRowProps = {
  item: Block;
  isSelected: boolean;
  isPreview?: boolean;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  inputRef: (ref: TextInput | null) => void;
};

function BlockRow({ item, isSelected, isPreview, onChangeText, onBackspaceEmpty, inputRef }: BlockRowProps) {
  return (
    <View style={[styles.blockRow, isSelected && styles.blockRowSelected]}>
      <View style={styles.dragHandle}>
        <Ionicons
          name={isSelected ? 'checkmark-circle' : 'reorder-two-outline'}
          size={20}
          color={isSelected ? ACCENT : '#9CA3AF'}
        />
      </View>
      <TextInput
        ref={inputRef}
        value={item.text}
        editable={!isPreview}
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
// invisible. So both drag-to-reorder AND swipe-to-select are hand-built
// directly on gesture-handler + reanimated: a plain View per block (no
// virtualization, fine for a single document's block count), each row's
// position measured via onLayout, a long-press-then-pan gesture that
// reorders the underlying array live (with LayoutAnimation smoothing the
// other rows sliding out of the way) while a floating clone follows the
// finger, raced against a quick horizontal pan that toggles selection.
type SortableBlockRowProps = {
  item: Block;
  isSelected: boolean;
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
  const swipeX = useSharedValue(0);

  const dragGesture = Gesture.Pan()
    .activateAfterLongPress(DRAG_LONG_PRESS_MS)
    .runOnJS(true)
    .onStart(() => onDragStart())
    .onUpdate((e) => onDragUpdate(e.translationY))
    .onEnd(() => onDragEnd());

  // Requires a clear horizontal intent (15px) before activating, and gives
  // up immediately on vertical intent (10px), so it never fights the drag
  // gesture above or the row's own vertical text-scrolling.
  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-10, 10])
    .runOnJS(true)
    .onUpdate((e) => {
      swipeX.value = Math.min(0, e.translationX);
    })
    .onEnd((e) => {
      if (e.translationX < -SWIPE_SELECT_THRESHOLD) {
        onToggleSelected(item.id);
      }
      swipeX.value = withTiming(0, { duration: 150 });
    });

  const gesture = Gesture.Race(dragGesture, swipeGesture);

  const swipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeX.value }],
  }));

  return (
    <View style={styles.rowShell} onLayout={onLayout}>
      <View style={styles.swipeUnderlay}>
        <Ionicons name="checkmark" size={20} color="#fff" />
      </View>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ opacity: isDragging ? 0 : 1 }, swipeStyle]}>
          <BlockRow
            item={item}
            isSelected={isSelected}
            onChangeText={onChangeText}
            onBackspaceEmpty={onBackspaceEmpty}
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
  onToggleSelected: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  onInputRef: (id: string, ref: TextInput | null) => void;
};

function BlockList({
  blocks,
  onReorder,
  selectedIds,
  onToggleSelected,
  onChangeText,
  onBackspaceEmpty,
  onInputRef,
}: BlockListProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragY = useSharedValue(0);
  const rowLayouts = useRef<Record<string, { y: number; height: number }>>({});
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  function handleRowLayout(id: string, e: LayoutChangeEvent) {
    rowLayouts.current[id] = {
      y: e.nativeEvent.layout.y,
      height: e.nativeEvent.layout.height,
    };
  }

  function maybeReorder(id: string, translationY: number) {
    const layout = rowLayouts.current[id];
    if (!layout) return;
    const currentCenter = layout.y + translationY + layout.height / 2;
    const list = blocksRef.current;
    const currentIndex = list.findIndex((b) => b.id === id);
    if (currentIndex === -1) return;
    let targetIndex = currentIndex;
    for (let i = 0; i < list.length; i++) {
      const rl = rowLayouts.current[list[i].id];
      if (!rl) continue;
      if (currentCenter >= rl.y && currentCenter < rl.y + rl.height) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex !== currentIndex) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const next = [...list];
      const [moved] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, moved);
      onReorder(next);
    }
  }

  function handleDragStart(id: string) {
    dragY.value = 0;
    setDraggingId(id);
  }

  function handleDragUpdate(id: string, translationY: number) {
    dragY.value = translationY;
    maybeReorder(id, translationY);
  }

  function handleDragEnd() {
    dragY.value = withTiming(0, { duration: 150 });
    setDraggingId(null);
  }

  const floatingStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  const draggingLayout = draggingId ? rowLayouts.current[draggingId] : null;
  const draggingBlock = draggingId ? blocks.find((b) => b.id === draggingId) : null;

  return (
    <View style={styles.blockListContainer}>
      {blocks.map((item) => (
        <SortableBlockRow
          key={item.id}
          item={item}
          isSelected={selectedIds.has(item.id)}
          isDragging={draggingId === item.id}
          onLayout={(e) => handleRowLayout(item.id, e)}
          onDragStart={() => handleDragStart(item.id)}
          onDragUpdate={(translationY) => handleDragUpdate(item.id, translationY)}
          onDragEnd={handleDragEnd}
          onToggleSelected={onToggleSelected}
          onChangeText={onChangeText}
          onBackspaceEmpty={onBackspaceEmpty}
          inputRef={(ref) => onInputRef(item.id, ref)}
        />
      ))}

      {draggingBlock && draggingLayout && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.floatingRow,
            { top: draggingLayout.y, height: draggingLayout.height },
            floatingStyle,
          ]}
        >
          <BlockRow
            item={draggingBlock}
            isSelected={selectedIds.has(draggingBlock.id)}
            isPreview
            onChangeText={() => {}}
            onBackspaceEmpty={() => {}}
            inputRef={() => {}}
          />
        </Animated.View>
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
        <View style={{ width: 22 }} />
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
  rowShell: {
    // Deliberately no explicit height here - the underlay below is
    // absolutely positioned and fills whatever height the foreground row
    // (in normal flow) ends up with, so it never forces a `flex: 1`
    // collapse the way the swipeable-item library's own layout did.
  },
  swipeUnderlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: ACCENT,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 22,
    borderRadius: 10,
  },
  floatingRow: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 100,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
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
