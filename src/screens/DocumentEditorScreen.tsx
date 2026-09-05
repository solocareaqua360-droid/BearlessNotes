import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Keyboard,
  LayoutAnimation,
  LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
// The new expo-file-system File/Directory API tracks read permission per
// picked URI internally and rejects copying a URI it didn't hand out
// itself ("Missing 'READ' permission") - the legacy module just wraps a
// plain native file copy given two paths, which is what actually works
// for re-homing a file expo-document-picker (a different module) picked.
import * as LegacyFileSystem from 'expo-file-system/legacy';
// react-native-gesture-handler's own ScrollView (not the core RN one) so it
// shares the same touch arena as our rows' Pan gestures - otherwise a swipe
// starting on a block (its TextInput especially) never reaches the
// ScrollView's own scroll recognition and only the icon column can scroll.
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
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
import { Block, BlockType } from '../types';
import { RootStackParamList } from '../navigation';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';
const AUTOSAVE_DELAY_MS = 600;
const DRAG_LONG_PRESS_MS = 350;

// Small fixed palette rather than a full color picker - enough variety for
// notes without the complexity of a hue/saturation UI.
const TEXT_COLORS = ['#111827', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6'];
const HIGHLIGHT_COLORS = ['#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#E9D5FF'];

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Firestore rejects `undefined` anywhere in a document, so every block is
// built through this one place instead of ad-hoc object literals scattered
// around - it never sets a field it doesn't need (checked only exists on
// checkbox blocks) rather than setting that field to undefined.
function buildBlock(id: string, type: BlockType, text: string): Block {
  const block: Block = { id, text, type };
  if (type === 'checkbox') block.checked = false;
  return block;
}

function newBlock(): Block {
  return buildBlock(generateId(), 'paragraph', '');
}

const LIST_TYPES: BlockType[] = ['bulleted', 'numbered', 'checkbox'];

// A generic document icon, tinted per extension so a PDF/Word/Excel
// attachment is recognizable at a glance without needing per-brand icons.
function fileIconFor(name?: string): 'document-text-outline' | 'document-outline' {
  return (name ?? '').toLowerCase().endsWith('.pdf') ? 'document-text-outline' : 'document-outline';
}

function fileIconColorFor(name?: string): string {
  const ext = (name ?? '').toLowerCase().split('.').pop();
  if (ext === 'pdf') return '#DC2626';
  if (ext === 'doc' || ext === 'docx') return '#2563EB';
  if (ext === 'xls' || ext === 'xlsx') return '#16A34A';
  return '#6B7280';
}

// Inline formatting is stored as plain markers inside the block's own text
// (**bold**, *italic*, __underline__, ~~strikethrough~~, {c:#hex}color{/c},
// {h:#hex}highlight{/h}) rather than a separate rich-text model - Android's
// TextInput can't render live bold-while-typing inside an editable field
// regardless of data model, so there was nothing to gain from a heavier
// representation. Markers are visible as-is while a block is being edited
// (see BlockRow) and parsed into styled <Text> runs otherwise.
const COLOR_OPEN = /^\{c:(#[0-9A-Fa-f]{6})\}/;
const HIGHLIGHT_OPEN = /^\{h:(#[0-9A-Fa-f]{6})\}/;
const COLOR_CLOSE = '{/c}';
const HIGHLIGHT_CLOSE = '{/h}';

type TextStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  highlight?: string;
};

type TextSegment = TextStyle & { text: string };

function parseFormattedText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  parseFormattedInto(text, {}, segments);
  return segments;
}

function parseFormattedInto(text: string, style: TextStyle, out: TextSegment[]) {
  let i = 0;
  let plainStart = 0;
  const flushPlain = (end: number) => {
    if (end > plainStart) out.push({ text: text.slice(plainStart, end), ...style });
  };
  while (i < text.length) {
    const rest = text.slice(i);
    let consumed = 0;
    if (rest.startsWith('**')) {
      const close = rest.indexOf('**', 2);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(2, close), { ...style, bold: true }, out);
        consumed = close + 2;
      }
    } else if (rest.startsWith('__')) {
      const close = rest.indexOf('__', 2);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(2, close), { ...style, underline: true }, out);
        consumed = close + 2;
      }
    } else if (rest.startsWith('~~')) {
      const close = rest.indexOf('~~', 2);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(2, close), { ...style, strikethrough: true }, out);
        consumed = close + 2;
      }
    } else if (rest.startsWith('*')) {
      const close = rest.indexOf('*', 1);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(1, close), { ...style, italic: true }, out);
        consumed = close + 1;
      }
    } else if (COLOR_OPEN.test(rest)) {
      const m = rest.match(COLOR_OPEN)!;
      const close = rest.indexOf(COLOR_CLOSE, m[0].length);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(m[0].length, close), { ...style, color: m[1] }, out);
        consumed = close + COLOR_CLOSE.length;
      }
    } else if (HIGHLIGHT_OPEN.test(rest)) {
      const m = rest.match(HIGHLIGHT_OPEN)!;
      const close = rest.indexOf(HIGHLIGHT_CLOSE, m[0].length);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(m[0].length, close), { ...style, highlight: m[1] }, out);
        consumed = close + HIGHLIGHT_CLOSE.length;
      }
    }
    if (consumed > 0) {
      i += consumed;
      plainStart = i;
    } else {
      i++;
    }
  }
  flushPlain(text.length);
}

function FormattedText({ segments, defaultColor }: { segments: TextSegment[]; defaultColor: string }) {
  return (
    <>
      {segments.map((seg, i) => {
        const decorations = [seg.underline && 'underline', seg.strikethrough && 'line-through']
          .filter(Boolean)
          .join(' ');
        return (
          <Text
            key={i}
            style={{
              fontWeight: seg.bold ? '700' : '400',
              fontStyle: seg.italic ? 'italic' : 'normal',
              textDecorationLine: (decorations || 'none') as 'none' | 'underline' | 'line-through',
              color: seg.color ?? defaultColor,
              backgroundColor: seg.highlight,
            }}
          >
            {seg.text}
          </Text>
        );
      })}
    </>
  );
}

// Content of a single block: a leading icon (a drag handle normally, or a
// checkbox while select mode is on) and the block's own content, which
// varies by type (see below). Dragging is handled by the wrapping
// SortableBlockRow below, not in here.
type BlockRowProps = {
  item: Block;
  isSelected: boolean;
  isSelectMode: boolean;
  isEditMode: boolean;
  showBoundary: boolean;
  listNumber?: number;
  textVersion: number;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onToggleChecked: (id: string) => void;
  onFocus: (id: string) => void;
  onSelectionChange: (id: string, start: number, end: number) => void;
  onOpenImage: (uri: string) => void;
  onToggleImageFit: (id: string) => void;
  onOpenFile: (id: string) => void;
  inputRef: (ref: TextInput | null) => void;
};

function BlockRow({
  item,
  isSelected,
  isSelectMode,
  isEditMode,
  showBoundary,
  listNumber,
  textVersion,
  onChangeText,
  onBackspaceEmpty,
  onToggleSelected,
  onToggleChecked,
  onFocus,
  onSelectionChange,
  onOpenImage,
  onToggleImageFit,
  onOpenFile,
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
  const type = item.type ?? 'paragraph';

  let content: ReactNode;
  if (type === 'divider') {
    content = <View style={styles.dividerLine} />;
  } else if (type === 'image') {
    // 'contain' keeps the photo's real proportions, with any leftover space
    // in the fixed-height box showing the box's own pale gray background
    // instead of cropping the image; 'cover' fills the box entirely,
    // cropping whatever doesn't fit. The small corner button switches
    // between the two per image.
    const fit = item.imageFit ?? 'contain';
    content = item.imageUri ? (
      <View style={styles.blockImageWrap}>
        <Pressable
          disabled={isSelectMode}
          onPress={() => onOpenImage(item.imageUri!)}
          style={styles.blockImageTap}
        >
          <Image source={{ uri: item.imageUri }} style={styles.blockImage} resizeMode={fit} />
        </Pressable>
        {!isSelectMode && (
          <Pressable
            hitSlop={8}
            style={styles.imageFitToggle}
            onPress={() => onToggleImageFit(item.id)}
          >
            <Ionicons name={fit === 'contain' ? 'crop-outline' : 'contract-outline'} size={16} color="#fff" />
          </Pressable>
        )}
      </View>
    ) : (
      <Text style={styles.blockPlaceholder}>Немає зображення</Text>
    );
  } else if (type === 'file') {
    // No cloud upload yet - the URI is the file picker's own local cache
    // copy, so opening it (via the OS's "open with" sheet) works instantly
    // and offline on this device, but the block won't resolve on another one.
    content = (
      <Pressable
        disabled={isSelectMode}
        onPress={() => onOpenFile(item.id)}
        style={styles.fileBlockRow}
      >
        <Ionicons name={fileIconFor(item.fileName)} size={22} color={fileIconColorFor(item.fileName)} />
        <Text style={styles.fileBlockName} numberOfLines={1}>
          {item.fileName ?? 'Файл'}
        </Text>
      </Pressable>
    );
  } else {
    const textField = canEditText ? (
      <TextInput
        // Android's TextInput doesn't reliably pick up a dynamic `editable`
        // change on an already-mounted view; keying on canEditText forces
        // a clean remount so the native EditText is created with the
        // correct editable/pointerEvents state instead of getting stuck
        // non-editable. textVersion is folded in too - see its declaration
        // for why (avoids a transient grow/shrink flicker on Enter-split).
        key={`editable-${textVersion}`}
        ref={inputRef}
        value={item.text}
        onChangeText={(text) => onChangeText(item.id, text)}
        onFocus={() => onFocus(item.id)}
        onSelectionChange={({ nativeEvent }) =>
          onSelectionChange(item.id, nativeEvent.selection.start, nativeEvent.selection.end)
        }
        onKeyPress={({ nativeEvent }) => {
          if (nativeEvent.key === 'Backspace' && item.text === '') {
            onBackspaceEmpty(item.id);
          }
        }}
        placeholder={type === 'checkbox' ? 'Завдання…' : 'Пишіть тут… ("/" для меню)'}
        style={[styles.blockInput, item.checked && styles.checkedText]}
        multiline
      />
    ) : (
      // Outside edit mode, formatting markers (**bold** etc.) are parsed
      // into styled runs instead of showing as raw text - and a plain
      // Text has no touch handling of its own to fight the ScrollView.
      <View key="locked" style={styles.blockInput} pointerEvents="none">
        <Text style={[styles.blockDisplayText, item.checked && styles.checkedText]}>
          {item.text ? (
            <FormattedText segments={parseFormattedText(item.text)} defaultColor="#111827" />
          ) : (
            <Text style={styles.blockPlaceholder}>Пишіть тут…</Text>
          )}
        </Text>
      </View>
    );

    if (type === 'bulleted' || type === 'numbered') {
      content = (
        <View style={styles.prefixedRow}>
          <Text style={styles.bulletMark}>{type === 'numbered' ? `${listNumber ?? 1}.` : '•'}</Text>
          {textField}
        </View>
      );
    } else if (type === 'checkbox') {
      content = (
        <View style={styles.prefixedRow}>
          <Pressable hitSlop={8} onPress={() => onToggleChecked(item.id)}>
            <Ionicons
              name={item.checked ? 'checkbox' : 'square-outline'}
              size={20}
              color={item.checked ? ACCENT : '#9CA3AF'}
            />
          </Pressable>
          {textField}
        </View>
      );
    } else {
      content = textField;
    }
  }

  return (
    <View
      style={[styles.blockRow, isSelected && styles.blockRowSelected, showBoundary && styles.blockRowBoundary]}
    >
      {content}
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
  listNumber?: number;
  textVersion: number;
  onLayout: (e: LayoutChangeEvent) => void;
  onDragStart: () => void;
  onDragUpdate: (translationY: number) => void;
  onDragEnd: () => void;
  onToggleSelected: (id: string) => void;
  onToggleChecked: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  onFocus: (id: string) => void;
  onSelectionChange: (id: string, start: number, end: number) => void;
  onOpenImage: (uri: string) => void;
  onToggleImageFit: (id: string) => void;
  onOpenFile: (id: string) => void;
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
  listNumber,
  textVersion,
  onLayout,
  onDragStart,
  onDragUpdate,
  onDragEnd,
  onToggleSelected,
  onToggleChecked,
  onChangeText,
  onBackspaceEmpty,
  onFocus,
  onSelectionChange,
  onOpenImage,
  onToggleImageFit,
  onOpenFile,
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
            listNumber={listNumber}
            textVersion={textVersion}
            onChangeText={onChangeText}
            onBackspaceEmpty={onBackspaceEmpty}
            onToggleSelected={onToggleSelected}
            onToggleChecked={onToggleChecked}
            onFocus={onFocus}
            onSelectionChange={onSelectionChange}
            onOpenImage={onOpenImage}
            onToggleImageFit={onToggleImageFit}
            onOpenFile={onOpenFile}
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
  textVersions: Record<string, number>;
  onToggleSelected: (id: string) => void;
  onToggleChecked: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  onFocus: (id: string) => void;
  onSelectionChange: (id: string, start: number, end: number) => void;
  onOpenImage: (uri: string) => void;
  onToggleImageFit: (id: string) => void;
  onOpenFile: (id: string) => void;
  onInputRef: (id: string, ref: TextInput | null) => void;
};

function BlockList({
  blocks,
  onReorder,
  selectedIds,
  isSelectMode,
  isEditMode,
  textVersions,
  onToggleSelected,
  onToggleChecked,
  onChangeText,
  onBackspaceEmpty,
  onFocus,
  onSelectionChange,
  onOpenImage,
  onToggleImageFit,
  onOpenFile,
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
          isSelected={selectedIds.has(item.id)}
          isSelectMode={isSelectMode}
          isEditMode={isEditMode}
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
          onChangeText={onChangeText}
          onBackspaceEmpty={onBackspaceEmpty}
          onFocus={onFocus}
          onSelectionChange={onSelectionChange}
          onOpenImage={onOpenImage}
          onToggleImageFit={onToggleImageFit}
          onOpenFile={onOpenFile}
          inputRef={(ref) => onInputRef(item.id, ref)}
        />
        );
      })}

      {draggingIds && insertIndex !== null && (
        <Animated.View pointerEvents="none" style={[styles.dropLine, dropLineStyle]} />
      )}
    </View>
  );
}

// Full-screen viewer opened by tapping an image block - pinch to zoom in,
// drag around once zoomed, pinching back below 1x snaps back to the
// original fit. Hand-built on the same gesture-handler/reanimated stack
// already used everywhere else in this screen rather than adding a
// dedicated image-viewer dependency for this one feature.
function ZoomableImageViewer({ uri, onClose }: { uri: string; onClose: () => void }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, savedScale.value * e.scale);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        savedScale.value = 1;
      }
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (savedScale.value <= 1) return;
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const gesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={styles.viewerBackdrop}>
      <Pressable style={styles.viewerCloseButton} hitSlop={12} onPress={onClose}>
        <Ionicons name="close" size={28} color="#fff" />
      </Pressable>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.viewerImageWrap, animatedStyle]}>
          <Image source={{ uri }} style={styles.viewerImage} resizeMode="contain" />
        </Animated.View>
      </GestureDetector>
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
  const [activeSelection, setActiveSelection] = useState<{ blockId: string; start: number; end: number } | null>(
    null
  );
  const [slashMenuBlockId, setSlashMenuBlockId] = useState<string | null>(null);
  const [viewerImageUri, setViewerImageUri] = useState<string | null>(null);
  const focusIdRef = useRef<string | null>(null);
  const focusToEndRef = useRef(false);
  const focusedBlockIdRef = useRef<string | null>(null);
  // A block whose text gets truncated by splitting off a new block below it
  // (Enter in a list item, or the paragraph double-Enter) keeps the SAME
  // native EditText instance - Android briefly renders that EditText's own
  // uncontrolled multi-line content (still holding the newline the user just
  // typed) before the corrected, newline-free `value` prop reaches it a
  // render later, growing the row by a line and then shrinking it back. That
  // transient grow/shrink is what shows up as the screen jumping up and then
  // back down to the edited line. Bumping this per-block counter and folding
  // it into the TextInput's key forces a fresh EditText - mounted directly
  // with the already-correct text - instead of updating the old one in place.
  const textVersionsRef = useRef<Record<string, number>>({});

  function bumpTextVersion(id: string) {
    textVersionsRef.current[id] = (textVersionsRef.current[id] ?? 0) + 1;
  }
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
  // "jumps up then down" the user saw. Single-Enter now creates a new list
  // item on every press (not just double-Enter), so this focus-swap blip
  // happens far more often; 60ms wasn't always longer than the gap between
  // the focus-driven call and the keyboard-driven one, so both could still
  // fire as two separate scrolls. 180ms comfortably covers that gap.
  const scrollAdjustTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleScrollAdjust(currentKeyboardHeight: number) {
    if (scrollAdjustTimeoutRef.current) clearTimeout(scrollAdjustTimeoutRef.current);
    scrollAdjustTimeoutRef.current = setTimeout(() => {
      scrollFocusedBlockIntoView(currentKeyboardHeight);
    }, 180);
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

  // Drives the formatting toolbar: it only shows for a real (non-empty)
  // selection, since there's nothing to apply Bold/Italic/etc. to otherwise.
  function handleBlockSelectionChange(id: string, start: number, end: number) {
    setActiveSelection(start === end ? null : { blockId: id, start, end });
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

  // Wraps (or unwraps, if already exactly wrapped) the active selection
  // with a marker pair, then restores the selection over the same text so
  // repeated taps toggle cleanly and the user can keep applying more
  // formats to the same range.
  function applyMarkerToSelection(open: string, close: string) {
    const sel = activeSelection;
    if (!sel) return;
    const block = blocks.find((b) => b.id === sel.blockId);
    if (!block) return;
    const before = block.text.slice(0, sel.start);
    const selected = block.text.slice(sel.start, sel.end);
    const after = block.text.slice(sel.end);
    // A single '*' (italic) also matches the tail of '**' (bold), so a
    // plain endsWith/startsWith would misfire "already italic" on text
    // that's actually bold-wrapped. Require the boundary to be exactly
    // this marker, not a longer one that happens to contain it.
    const isExactBoundary =
      open === '*'
        ? before.endsWith('*') && !before.endsWith('**') && after.startsWith('*') && !after.startsWith('**')
        : before.endsWith(open) && after.startsWith(close);
    let newText: string;
    let newStart: number;
    if (isExactBoundary) {
      newText = before.slice(0, -open.length) + selected + after.slice(close.length);
      newStart = sel.start - open.length;
    } else {
      newText = before + open + selected + close + after;
      newStart = sel.start + open.length;
    }
    const newEnd = newStart + selected.length;
    snapshotBeforeChange();
    setBlocks((prev) => prev.map((b) => (b.id === sel.blockId ? { ...b, text: newText } : b)));
    setActiveSelection({ blockId: sel.blockId, start: newStart, end: newEnd });
    requestAnimationFrame(() => {
      inputRefs.current[sel.blockId]?.setSelection(newStart, newEnd);
    });
  }

  // Color/highlight need their own version since the "already applied"
  // check has to match any hex value, not one fixed marker, and re-tapping
  // a different swatch should replace the color rather than nest a second
  // tag around the first.
  function applyColorToSelection(kind: 'c' | 'h', hex: string) {
    const sel = activeSelection;
    if (!sel) return;
    const block = blocks.find((b) => b.id === sel.blockId);
    if (!block) return;
    const openPattern = kind === 'c' ? COLOR_OPEN : HIGHLIGHT_OPEN;
    const closeTag = kind === 'c' ? COLOR_CLOSE : HIGHLIGHT_CLOSE;
    const before = block.text.slice(0, sel.start);
    const selected = block.text.slice(sel.start, sel.end);
    const after = block.text.slice(sel.end);
    // openPattern is anchored to the start of a string (^...) for matching
    // an upcoming tag while parsing; here we need "ends with", so the
    // leading ^ has to be dropped before anchoring to the end instead.
    const existingOpenMatch = before.match(new RegExp(openPattern.source.replace(/^\^/, '') + '$'));
    const hasExistingClose = after.startsWith(closeTag);
    let newText: string;
    let newStart: number;
    if (existingOpenMatch && hasExistingClose) {
      const existingHex = existingOpenMatch[1];
      if (existingHex.toLowerCase() === hex.toLowerCase()) {
        // Same color already applied - remove it.
        newText = before.slice(0, -existingOpenMatch[0].length) + selected + after.slice(closeTag.length);
        newStart = sel.start - existingOpenMatch[0].length;
      } else {
        // Different color - swap the hex value in place, tag lengths match.
        const newOpen = `{${kind}:${hex}}`;
        newText = before.slice(0, -existingOpenMatch[0].length) + newOpen + selected + after;
        newStart = sel.start - existingOpenMatch[0].length + newOpen.length;
      }
    } else {
      const openTag = `{${kind}:${hex}}`;
      newText = before + openTag + selected + closeTag + after;
      newStart = sel.start + openTag.length;
    }
    const newEnd = newStart + selected.length;
    snapshotBeforeChange();
    setBlocks((prev) => prev.map((b) => (b.id === sel.blockId ? { ...b, text: newText } : b)));
    setActiveSelection({ blockId: sel.blockId, start: newStart, end: newEnd });
    requestAnimationFrame(() => {
      inputRefs.current[sel.blockId]?.setSelection(newStart, newEnd);
    });
  }

  function handleBlockChange(id: string, text: string) {
    snapshotForTyping();
    // Typing "/" as the very first character of an empty block opens the
    // quick-add menu; typing anything else (including deleting back to
    // empty) closes it again if it was open for this block.
    if (text === '/') {
      setSlashMenuBlockId(id);
    } else if (slashMenuBlockId === id) {
      setSlashMenuBlockId(null);
    }
    const currentType = blocks.find((b) => b.id === id)?.type ?? 'paragraph';

    // List items (bulleted/numbered/checkbox) continue the list on a
    // single Enter instead of needing a second one - typing a whole
    // sentence per item would be tedious otherwise. Pressing Enter on an
    // already-empty item exits the list instead of adding another blank
    // one, matching how most list editors behave.
    if (LIST_TYPES.includes(currentType)) {
      const newlineIndex = text.indexOf('\n');
      if (newlineIndex !== -1) {
        const before = text.slice(0, newlineIndex);
        const after = text.slice(newlineIndex + 1);
        if (before === '') {
          setBlocks((prev) => prev.map((b) => (b.id === id ? buildBlock(b.id, 'paragraph', after) : b)));
          return;
        }
        const created = buildBlock(generateId(), currentType, after);
        focusIdRef.current = created.id;
        bumpTextVersion(id);
        setBlocks((prev) => {
          const index = prev.findIndex((b) => b.id === id);
          if (index === -1) return prev;
          const next = [...prev];
          next[index] = { ...next[index], text: before };
          next.splice(index + 1, 0, created);
          return next;
        });
        return;
      }
      setBlocks((prev) => prev.map((block) => (block.id === id ? { ...block, text } : block)));
      return;
    }

    // React Native's TextInput never reports whether Shift was held for
    // Enter (Android's own bridge code discards that before it reaches JS,
    // on any keyboard, soft or hardware) - so for a plain paragraph, a
    // single Enter has to just be a line break within the block, and
    // creating a new block instead needs its own distinct signal: pressing
    // Enter again on the resulting empty line, i.e. two consecutive
    // newlines.
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
    bumpTextVersion(id);
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

  function toggleChecked(id: string) {
    snapshotBeforeChange();
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, checked: !b.checked } : b)));
  }

  function toggleImageFit(id: string) {
    snapshotBeforeChange();
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, imageFit: (b.imageFit ?? 'contain') === 'contain' ? 'cover' : 'contain' } : b
      )
    );
  }

  // Converts the block that triggered the "/" menu into the chosen type.
  // Divider blocks hold no text, so there's nothing left to type into them -
  // a fresh empty paragraph is inserted right after (only if one doesn't
  // already follow) and gets focus, so the user can keep writing without an
  // extra tap. List/checkbox blocks keep editing the same block instead,
  // since their whole point is typing a label into them.
  function convertBlockType(id: string, type: BlockType) {
    snapshotBeforeChange();
    setSlashMenuBlockId(null);
    if (type === 'divider') {
      setBlocks((prev) => {
        const index = prev.findIndex((b) => b.id === id);
        if (index === -1) return prev;
        const next = [...prev];
        next[index] = buildBlock(id, 'divider', '');
        if (index === next.length - 1) {
          const trailing = newBlock();
          next.splice(index + 1, 0, trailing);
          focusIdRef.current = trailing.id;
        } else {
          focusIdRef.current = next[index + 1].id;
        }
        return next;
      });
    } else {
      focusIdRef.current = id;
      setBlocks((prev) => prev.map((b) => (b.id === id ? buildBlock(id, type, '') : b)));
    }
  }

  // Longest side capped at 1600px (skipped if already smaller) and
  // re-compressed to a moderate JPEG quality, so a multi-megabyte photo
  // straight from a modern phone camera doesn't get stored at full size in
  // every document. Falls back to the picker's own output if manipulation
  // fails for any reason - a slightly larger image beats losing the pick.
  async function compressPickedImage(uri: string, width: number, height: number): Promise<string> {
    const MAX_DIMENSION = 1600;
    try {
      const longest = Math.max(width, height);
      let context = ImageManipulator.manipulate(uri);
      if (longest > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / longest;
        context = context.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
      }
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
      return saved.uri;
    } catch {
      return uri;
    }
  }

  async function pickImageForBlock(id: string) {
    setSlashMenuBlockId(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const uri = await compressPickedImage(asset.uri, asset.width, asset.height);
    snapshotBeforeChange();
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      if (index === -1) return prev;
      const next = [...prev];
      next[index] = { ...buildBlock(id, 'image', ''), imageUri: uri };
      if (index === next.length - 1) {
        const trailing = newBlock();
        next.splice(index + 1, 0, trailing);
        focusIdRef.current = trailing.id;
      } else {
        focusIdRef.current = next[index + 1].id;
      }
      return next;
    });
  }

  // No cloud upload yet - the picker's own cache copy is what gets stored
  // and later opened, so this only works on the device the file was
  // attached from.
  async function pickFileForBlock(id: string) {
    setSlashMenuBlockId(null);
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    // The picker's own cache copy lives in a subfolder expo-sharing's
    // FileProvider doesn't recognize in Expo Go ("Not allowed to read file
    // under given URL" the moment the block is opened) - re-copying it
    // straight into the plain cache directory puts it somewhere Sharing can
    // actually read.
    const fileUri = `${LegacyFileSystem.cacheDirectory}${generateId()}-${asset.name}`;
    await LegacyFileSystem.copyAsync({ from: asset.uri, to: fileUri });
    snapshotBeforeChange();
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      if (index === -1) return prev;
      const next = [...prev];
      const fileBlock: Block = { ...buildBlock(id, 'file', ''), fileUri, fileName: asset.name };
      if (asset.mimeType) fileBlock.mimeType = asset.mimeType;
      next[index] = fileBlock;
      if (index === next.length - 1) {
        const trailing = newBlock();
        next.splice(index + 1, 0, trailing);
        focusIdRef.current = trailing.id;
      } else {
        focusIdRef.current = next[index + 1].id;
      }
      return next;
    });
  }

  async function openFileBlock(id: string) {
    const block = blocks.find((b) => b.id === id);
    if (!block?.fileUri) return;
    const available = await Sharing.isAvailableAsync();
    if (!available) return;
    await Sharing.shareAsync(block.fileUri, {
      mimeType: block.mimeType,
      dialogTitle: block.fileName,
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
      setActiveSelection(null);
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

      {slashMenuBlockId && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.formatToolbar}
          contentContainerStyle={styles.formatToolbarContent}
          keyboardShouldPersistTaps="always"
        >
          <Pressable
            style={styles.slashMenuItem}
            hitSlop={6}
            onPress={() => convertBlockType(slashMenuBlockId, 'bulleted')}
          >
            <Ionicons name="list-outline" size={20} color="#111827" />
            <Text style={styles.slashMenuLabel}>Список</Text>
          </Pressable>
          <Pressable
            style={styles.slashMenuItem}
            hitSlop={6}
            onPress={() => convertBlockType(slashMenuBlockId, 'numbered')}
          >
            <Ionicons name="list-outline" size={20} color="#111827" />
            <Text style={styles.slashMenuLabel}>Нумерований список</Text>
          </Pressable>
          <Pressable
            style={styles.slashMenuItem}
            hitSlop={6}
            onPress={() => convertBlockType(slashMenuBlockId, 'checkbox')}
          >
            <Ionicons name="checkbox-outline" size={20} color="#111827" />
            <Text style={styles.slashMenuLabel}>Чекбокс</Text>
          </Pressable>
          <Pressable
            style={styles.slashMenuItem}
            hitSlop={6}
            onPress={() => convertBlockType(slashMenuBlockId, 'divider')}
          >
            <Ionicons name="remove-outline" size={20} color="#111827" />
            <Text style={styles.slashMenuLabel}>Лінія</Text>
          </Pressable>
          <Pressable style={styles.slashMenuItem} hitSlop={6} onPress={() => pickImageForBlock(slashMenuBlockId)}>
            <Ionicons name="image-outline" size={20} color="#111827" />
            <Text style={styles.slashMenuLabel}>Зображення</Text>
          </Pressable>
          <Pressable style={styles.slashMenuItem} hitSlop={6} onPress={() => pickFileForBlock(slashMenuBlockId)}>
            <Ionicons name="document-outline" size={20} color="#111827" />
            <Text style={styles.slashMenuLabel}>Файл</Text>
          </Pressable>
        </ScrollView>
      )}

      {!slashMenuBlockId && activeSelection && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.formatToolbar}
          contentContainerStyle={styles.formatToolbarContent}
          keyboardShouldPersistTaps="always"
        >
          <Pressable hitSlop={6} onPress={() => applyMarkerToSelection('**', '**')}>
            <Text style={[styles.formatButtonLabel, { fontWeight: '700' }]}>Ж</Text>
          </Pressable>
          <Pressable hitSlop={6} onPress={() => applyMarkerToSelection('*', '*')}>
            <Text style={[styles.formatButtonLabel, { fontStyle: 'italic' }]}>К</Text>
          </Pressable>
          <Pressable hitSlop={6} onPress={() => applyMarkerToSelection('__', '__')}>
            <Text style={[styles.formatButtonLabel, { textDecorationLine: 'underline' }]}>П</Text>
          </Pressable>
          <Pressable hitSlop={6} onPress={() => applyMarkerToSelection('~~', '~~')}>
            <Text style={[styles.formatButtonLabel, { textDecorationLine: 'line-through' }]}>С</Text>
          </Pressable>
          <View style={styles.formatDivider} />
          {TEXT_COLORS.map((color) => (
            <Pressable key={color} hitSlop={6} onPress={() => applyColorToSelection('c', color)}>
              <View style={[styles.colorSwatch, { backgroundColor: color }]} />
            </Pressable>
          ))}
          <View style={styles.formatDivider} />
          {HIGHLIGHT_COLORS.map((color) => (
            <Pressable key={color} hitSlop={6} onPress={() => applyColorToSelection('h', color)}>
              <View style={[styles.colorSwatch, styles.highlightSwatch, { backgroundColor: color }]} />
            </Pressable>
          ))}
        </ScrollView>
      )}

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
          textVersions={textVersionsRef.current}
          onToggleSelected={toggleSelected}
          onToggleChecked={toggleChecked}
          onChangeText={handleBlockChange}
          onBackspaceEmpty={handleBackspaceOnEmpty}
          onFocus={handleBlockFocus}
          onSelectionChange={handleBlockSelectionChange}
          onOpenImage={setViewerImageUri}
          onToggleImageFit={toggleImageFit}
          onOpenFile={openFileBlock}
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

      {viewerImageUri && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setViewerImageUri(null)}
        >
          {/* RN's Modal renders into its own native window on Android, outside the
              app-level GestureHandlerRootView in App.tsx - gesture-handler
              gestures need their own root re-declared inside it or pinch/pan
              here silently do nothing. */}
          <GestureHandlerRootView style={{ flex: 1 }}>
            <ZoomableImageViewer uri={viewerImageUri} onClose={() => setViewerImageUri(null)} />
          </GestureHandlerRootView>
        </Modal>
      )}
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
  formatToolbar: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  formatToolbarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  formatButtonLabel: {
    fontSize: 17,
    color: '#111827',
    minWidth: 20,
    textAlign: 'center',
  },
  formatDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#E5E7EB',
  },
  colorSwatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  highlightSwatch: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
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
  blockDisplayText: {
    fontSize: 16,
    lineHeight: 22,
  },
  blockPlaceholder: {
    color: '#9CA3AF',
  },
  checkedText: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  prefixedRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bulletMark: {
    fontSize: 18,
    color: '#111827',
    paddingLeft: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 12,
    marginHorizontal: 4,
  },
  blockImageWrap: {
    flex: 1,
    height: 180,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    overflow: 'hidden',
  },
  blockImage: {
    width: '100%',
    height: '100%',
  },
  blockImageTap: {
    flex: 1,
  },
  imageFitToggle: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    padding: 5,
  },
  fileBlockRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  fileBlockName: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerCloseButton: {
    position: 'absolute',
    top: 48,
    right: 20,
    zIndex: 1,
    padding: 8,
  },
  viewerImageWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },
  slashMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  slashMenuLabel: {
    fontSize: 15,
    color: '#111827',
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
