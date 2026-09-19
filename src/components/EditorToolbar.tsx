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
import { NAV_BUTTON, NAV_GAP, NAV_PADDING } from '../constants/rail';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';

// Kept as fixed crayons, not the theme's own accent or its card palette:
// these colour the NOTE'S OWN TEXT, sitting on `paper` (always light,
// every theme), and a highlighter needs to stay a pale wash whatever the
// interface scheme is doing - unlike a card fill or a section colour,
// nothing here is app chrome.
const TEXT_COLORS = ['#111827', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6'];
const HIGHLIGHT_COLORS = ['#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#E9D5FF'];

export type ToolbarSelection = { blockId: string; start: number; end: number };

// The pill's real height - NAV_BUTTON tall inside, NAV_PADDING all
// round, same as every other face of this dock (docDock, the
// select-mode bar). Computed rather than a separate literal: the
// screen needs this exact number too (the list's bottom padding and
// the "scroll the focused block into view" maths both reserve exactly
// this much room above the keyboard), and the one time this bar's own
// height and that reserved space drifted apart, the next block's text
// showed through the gap.
export const EDITOR_TOOLBAR_HEIGHT = NAV_BUTTON + NAV_PADDING * 2;

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
        <GlassDrop style={styles.shell}>
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
      <GlassDrop style={styles.shell}>
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
  // Centers the pill and caps its width - the exact same shape as
  // docDock/docDockShell (documentEditorStyles.ts), reproduced here
  // rather than imported so this component stays self-contained; the
  // shared constants (NAV_PADDING/NAV_GAP/NAV_BUTTON) are what actually
  // keep the two pixel-identical.
  shellWrap: {
    alignItems: 'center',
  },
  shell: {
    padding: NAV_PADDING,
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
    width: NAV_BUTTON,
    height: NAV_BUTTON,
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
