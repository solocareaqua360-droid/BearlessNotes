import { Pressable, StyleSheet, Text, View } from 'react-native';
// Deliberately gesture-handler's ScrollView, not react-native's: the whole
// editor is built on gesture-handler (drag-to-reorder, swipe), and these
// two rows were rendered with that same component before they moved here.
import { ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { BLOCK_ACTIONS, BlockAction, BlockActionIcon } from './blockActions';

const TEXT_COLORS = ['#111827', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6'];
const HIGHLIGHT_COLORS = ['#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#E9D5FF'];

export type ToolbarSelection = { blockId: string; start: number; end: number };

// Content (~24px) plus the row's own vertical padding. The screen needs
// this number too - the bar is pinned over the block list, so the list's
// bottom padding and the "scroll the focused block into view" maths both
// have to reserve exactly this much room above the keyboard.
export const EDITOR_TOOLBAR_HEIGHT = 44;

type Props = {
  // The block actions apply to. null means no block is focused (e.g. the
  // title is), in which case there's nothing for the bar to act on and it
  // renders nothing.
  focusedBlockId: string | null;
  // Set while that block has a non-empty selection - formatting takes over
  // the row for as long as the selection stays non-empty, then the insert
  // row is back with no button needed to get there.
  activeSelection: ToolbarSelection | null;
  onBlockAction: (action: BlockAction, blockId: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onApplyMarker: (open: string, close: string) => void;
  onApplyColor: (kind: 'c' | 'h', hex: string) => void;
};

// The editor's one toolbar, pinned above the keyboard whenever a block is
// focused - not gated behind typing "/" or opening a menu, the way the
// insert actions used to be. Two rows share the surface:
//  - insert (default): undo, redo, then one icon per block type
//  - format: swaps in automatically for as long as there's a non-empty
//    text selection, swaps back out the moment the selection collapses -
//    no explicit "back" control, since the trigger (the selection) is the
//    same thing that would otherwise need one to leave
//
// Icons-only by design: the eight insert actions never fit alongside
// labels, and unlike a first-run menu a bar the user sees on every block
// is one they learn from repetition - a bottom sheet spelling out each
// name (an earlier version of this bar had one) turned out to be solving
// a problem that mostly didn't exist. Every icon still carries an
// accessibilityLabel, so nothing is lost to TalkBack.
//
// `keyboardShouldPersistTaps="always"` is load-bearing on both rows:
// without it, the first tap only dismisses the keyboard and never reaches
// the button - and dismissing the keyboard is exactly what the bar must
// never do, since every action here applies to the block still holding
// focus. If more block types show up later, this being a horizontal
// ScrollView already lets the row scroll rather than needing a rework.
export default function EditorToolbar({
  focusedBlockId,
  activeSelection,
  onBlockAction,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onApplyMarker,
  onApplyColor,
}: Props) {
  if (!focusedBlockId) return null;

  if (activeSelection) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.formatToolbar}
        contentContainerStyle={styles.formatToolbarContent}
        keyboardShouldPersistTaps="always"
      >
        <Pressable hitSlop={6} accessibilityLabel="Жирний" onPress={() => onApplyMarker('**', '**')}>
          <Text style={[styles.formatButtonLabel, { fontWeight: '700' }]}>Ж</Text>
        </Pressable>
        <Pressable hitSlop={6} accessibilityLabel="Курсив" onPress={() => onApplyMarker('*', '*')}>
          <Text style={[styles.formatButtonLabel, { fontStyle: 'italic' }]}>К</Text>
        </Pressable>
        <Pressable hitSlop={6} accessibilityLabel="Підкреслений" onPress={() => onApplyMarker('__', '__')}>
          <Text style={[styles.formatButtonLabel, { textDecorationLine: 'underline' }]}>П</Text>
        </Pressable>
        <Pressable hitSlop={6} accessibilityLabel="Закреслений" onPress={() => onApplyMarker('~~', '~~')}>
          <Text style={[styles.formatButtonLabel, { textDecorationLine: 'line-through' }]}>С</Text>
        </Pressable>
        <View style={styles.formatDivider} />
        {TEXT_COLORS.map((color) => (
          <Pressable
            key={color}
            hitSlop={6}
            accessibilityLabel="Колір тексту"
            onPress={() => onApplyColor('c', color)}
          >
            <View style={[styles.colorSwatch, { backgroundColor: color }]} />
          </Pressable>
        ))}
        <View style={styles.formatDivider} />
        {HIGHLIGHT_COLORS.map((color) => (
          <Pressable key={color} hitSlop={6} accessibilityLabel="Маркер" onPress={() => onApplyColor('h', color)}>
            <View style={[styles.colorSwatch, styles.highlightSwatch, { backgroundColor: color }]} />
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.formatToolbar}
      contentContainerStyle={styles.iconRowContent}
      keyboardShouldPersistTaps="always"
    >
      <Pressable
        style={styles.iconButton}
        accessibilityLabel="Скасувати"
        accessibilityRole="button"
        disabled={!canUndo}
        onPress={onUndo}
      >
        <Ionicons name="arrow-undo-outline" size={22} color={canUndo ? '#111827' : '#D1D5DB'} />
      </Pressable>
      <Pressable
        style={styles.iconButton}
        accessibilityLabel="Повторити"
        accessibilityRole="button"
        disabled={!canRedo}
        onPress={onRedo}
      >
        <Ionicons name="arrow-redo-outline" size={22} color={canRedo ? '#111827' : '#D1D5DB'} />
      </Pressable>
      <View style={styles.formatDivider} />
      {BLOCK_ACTIONS.map((action) => (
        <Pressable
          key={action.key}
          style={styles.iconButton}
          accessibilityLabel={action.label}
          accessibilityRole="button"
          onPress={() => onBlockAction(action.key, focusedBlockId)}
        >
          <BlockActionIcon entry={action} size={22} color="#111827" />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  formatToolbar: {
    flexGrow: 0,
    // Pinned above the keyboard rather than sitting under the header, so
    // the divider faces up and the row needs its own opaque background -
    // block text scrolls underneath it now.
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  formatToolbarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  // Icons-only row: the buttons carry their own touch area instead of
  // relying on hitSlop, so neighbours can sit close without their targets
  // overlapping.
  iconRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
  },
  iconButton: {
    width: 44,
    height: EDITOR_TOOLBAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
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
});
