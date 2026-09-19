import { Pressable, StyleSheet, Text, View } from 'react-native';
// Deliberately gesture-handler's ScrollView, not react-native's: the whole
// editor is built on gesture-handler (drag-to-reorder, swipe), and these
// two rows were rendered with that same component before they moved here.
import { ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { BLOCK_ACTIONS, BlockAction, BlockActionIcon } from './blockActions';
import GlassDrop from './GlassDrop';
import { useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { GLASS_EDGE, GLASS_TEXT, GLASS_TEXT_FAINT } from '../constants/glass';
import { NAV_GAP } from '../constants/rail';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';

// Kept as fixed crayons, not the theme's own accent or its card palette:
// these colour the NOTE'S OWN TEXT, sitting on `paper` (always light,
// every theme), and a highlighter needs to stay a pale wash whatever the
// interface scheme is doing - unlike a card fill or a section colour,
// nothing here is app chrome.
const TEXT_COLORS = ['#111827', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6'];
const HIGHLIGHT_COLORS = ['#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#E9D5FF'];

// Near-opaque, overriding the theme's own (0.05-0.55, tuned for a
// capsule floating over a mostly-still screen). This one floats over
// the exact text being read and scrolled underneath it while it types
// - the user's own report, with a screenshot: the theme's translucency
// let that scrolling text show straight through, unlike every other
// face of this dock, which sit over calmer ground.
const GLASS_OPACITY = 0.94;

export type ToolbarSelection = { blockId: string; start: number; end: number };

// Its OWN button size, smaller than the rest of this dock's NAV_BUTTON
// (48) - measured against the user's own complaint, on-device, that the
// glass version came out taller than the flat bar it replaced and
// covered noticeably more text. This bar sits directly over the block
// being typed in, where every extra pixel of height is a line of text
// the writer can no longer see while they write it; the Полотно/
// select-mode faces of this dock sit over calmer ground and can afford
// to be roomier. 36 + 4 padding each side = 44 - the flat bar's own old
// height, restored exactly rather than guessed at again.
const TOOLBAR_BUTTON = 36;
const TOOLBAR_PADDING = 4;

// Computed, not a separate literal: the screen needs this exact number
// too (the list's bottom padding and the "scroll the focused block into
// view" maths both reserve exactly this much room above the keyboard),
// and the one time this bar's own height and that reserved space
// drifted apart, the next block's text showed through the gap.
export const EDITOR_TOOLBAR_HEIGHT = TOOLBAR_BUTTON + TOOLBAR_PADDING * 2;

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
  // Same glass pill as the docDock below the block list - the
  // navigation redesign's second step, folding what used to be a flat
  // full-width bar (paper-coloured, a hard top border) into the one
  // floating capsule the Полотно dock and the select-mode bar already
  // share. It still rides the keyboard's own live height exactly as
  // before (see pinnedToolbarStyle in DocumentEditorScreen.tsx) - only
  // what it LOOKS like changed here, never how it tracks the keyboard.
  const styles = useStyles(makeStyles);
  if (!focusedBlockId) return null;

  if (activeSelection) {
    return (
      <View style={styles.shellWrap}>
        <GlassDrop style={styles.shell} glassOpacity={GLASS_OPACITY}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.formatRow}
            keyboardShouldPersistTaps="always"
          >
            <Pressable style={styles.iconButton} hitSlop={6} accessibilityLabel="Жирний" onPress={() => onApplyMarker('**', '**')}>
              <Text style={[styles.formatButtonLabel, { fontFamily: FONT_BOLD }]}>Ж</Text>
            </Pressable>
            <Pressable style={styles.iconButton} hitSlop={6} accessibilityLabel="Курсив" onPress={() => onApplyMarker('*', '*')}>
              <Text style={[styles.formatButtonLabel, { fontStyle: 'italic' }]}>К</Text>
            </Pressable>
            <Pressable style={styles.iconButton} hitSlop={6} accessibilityLabel="Підкреслений" onPress={() => onApplyMarker('__', '__')}>
              <Text style={[styles.formatButtonLabel, { textDecorationLine: 'underline' }]}>П</Text>
            </Pressable>
            <Pressable style={styles.iconButton} hitSlop={6} accessibilityLabel="Закреслений" onPress={() => onApplyMarker('~~', '~~')}>
              <Text style={[styles.formatButtonLabel, { textDecorationLine: 'line-through' }]}>С</Text>
            </Pressable>
            <View style={styles.divider} />
            {TEXT_COLORS.map((color) => (
              <Pressable
                key={color}
                style={styles.iconButton}
                hitSlop={6}
                accessibilityLabel="Колір тексту"
                onPress={() => onApplyColor('c', color)}
              >
                <View style={[styles.colorSwatch, { backgroundColor: color }]} />
              </Pressable>
            ))}
            <View style={styles.divider} />
            {HIGHLIGHT_COLORS.map((color) => (
              <Pressable key={color} style={styles.iconButton} hitSlop={6} accessibilityLabel="Маркер" onPress={() => onApplyColor('h', color)}>
                <View style={[styles.colorSwatch, styles.highlightSwatch, { backgroundColor: color }]} />
              </Pressable>
            ))}
          </ScrollView>
        </GlassDrop>
      </View>
    );
  }

  return (
    <View style={styles.shellWrap}>
      <GlassDrop style={styles.shell} glassOpacity={GLASS_OPACITY}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.iconRow}
          keyboardShouldPersistTaps="always"
        >
          <Pressable
            style={styles.iconButton}
            accessibilityLabel="Скасувати"
            accessibilityRole="button"
            disabled={!canUndo}
            onPress={onUndo}
          >
            <Ionicons name="arrow-undo-outline" size={22} color={canUndo ? GLASS_TEXT : GLASS_TEXT_FAINT} />
          </Pressable>
          <Pressable
            style={styles.iconButton}
            accessibilityLabel="Повторити"
            accessibilityRole="button"
            disabled={!canRedo}
            onPress={onRedo}
          >
            <Ionicons name="arrow-redo-outline" size={22} color={canRedo ? GLASS_TEXT : GLASS_TEXT_FAINT} />
          </Pressable>
          <View style={styles.divider} />
          {BLOCK_ACTIONS.map((action) => (
            <Pressable
              key={action.key}
              style={styles.iconButton}
              accessibilityLabel={action.label}
              accessibilityRole="button"
              onPress={() => onBlockAction(action.key, focusedBlockId)}
            >
              <BlockActionIcon entry={action} size={22} color={GLASS_TEXT} />
            </Pressable>
          ))}
        </ScrollView>
      </GlassDrop>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  // The same PILL SHAPE as docDock/docDockShell (centred, capped
  // width, GlassDrop) - but its own, smaller size: see TOOLBAR_BUTTON's
  // own comment for why this one can't afford NAV_BUTTON's 48.
  shellWrap: {
    alignItems: 'center',
  },
  shell: {
    padding: TOOLBAR_PADDING,
    maxWidth: '88%',
  },
  formatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: NAV_GAP,
    paddingHorizontal: 8,
  },
  // Icons-only row: the buttons carry their own touch area instead of
  // relying on hitSlop, so neighbours can sit close without their targets
  // overlapping.
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: NAV_GAP,
    paddingHorizontal: 4,
  },
  iconButton: {
    width: TOOLBAR_BUTTON,
    height: TOOLBAR_BUTTON,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formatButtonLabel: {
    fontSize: 17,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
    minWidth: 20,
    textAlign: 'center',
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: GLASS_EDGE,
  },
  colorSwatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  highlightSwatch: {
    borderWidth: 1,
    borderColor: GLASS_EDGE,
  },
});
