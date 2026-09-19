import { Pressable, StyleSheet, Text, View } from 'react-native';
// Deliberately gesture-handler's ScrollView, not react-native's: the whole
// editor is built on gesture-handler (drag-to-reorder, swipe), and these
// two rows were rendered with that same component before they moved here.
import { ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { BLOCK_ACTIONS, BlockAction, BlockActionIcon } from './blockActions';
import DockFrost from './DockFrost';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
// GLASS_TEXT and friends are GONE from this file (2026-09-19). They are
// fixed values for DARK glass - white ink, a white hairline - and this
// bar's own shell is near-opaque theme glass, which in the white theme
// is a pale pill. White icons on a pale pill are not faint, they are
// absent: the user's screenshot showed the bar standing over the text
// with nothing legible on it at all. `theme.glass.ink` is the role for
// exactly this - "the ink of a control STANDING on the glass, which is
// not the ink of the page" - and the dock beside it was already reading
// it, which is why the dock stayed visible while this did not.
import { NAV_GAP } from '../constants/rail';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';

// Kept as fixed crayons, not the theme's own accent or its card palette:
// these colour the NOTE'S OWN TEXT, sitting on `paper` (always light,
// every theme), and a highlighter needs to stay a pale wash whatever the
// interface scheme is doing - unlike a card fill or a section colour,
// nothing here is app chrome.
const TEXT_COLORS = ['#111827', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6'];
const HIGHLIGHT_COLORS = ['#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#E9D5FF'];

// THIS BAR IS MADE OF THE DOCK, not of GlassDrop with its numbers
// turned up (2026-09-19).
//
// It wore GlassDrop at glassOpacity 0.94, raised from the theme's own
// because the user reported - with a screenshot - that the scrolling
// text underneath showed straight through it, unlike every other face
// of this dock, which sit over calmer ground. Two things were wrong with
// that answer. In the WHITE theme it makes a pale pill, and the icons
// on it were fixed white constants, so the bar was there and held
// nothing legible: "слеш панель невидно". And in the BLACK theme it is
// worse than pale - that theme's glass BODY is #FFFFFF at 5%, so raising
// its opacity makes a white slab, which is a trap this project has
// already sprung once and written down.
//
// DockFrost is the material the dock is actually made of - the tags
// drawer's two layers, picked by the user's own eye and confirmed
// on-device. It is dense enough that nothing reads through it, and its
// ink is the theme's `glass.ink`, so the pair cannot come apart in any
// theme. One material, one place it is defined.
//
// WITHOUT ITS LIVE BLUR, though - `blur={false}`, and the reason is
// this bar specifically. It rides the keyboard's own live height, so
// its position changes on every frame of the keyboard's animation,
// directly over the text being typed. `dimezisBlurView` re-captures
// and re-blurs what is beneath it, so a surface that moves every frame
// makes it do that every frame. Tapping into any text field - a note,
// or the calendar's daily note, folded or not - froze the app until
// Android killed it: "зависає і потім закривається". The colour recipe
// is unchanged; only the live layer is gone, and the fill is denser to
// do that layer's job on its own.

export type ToolbarSelection = { blockId: string; start: number; end: number };

// What the bar offers on the canvas: the actions that CONVERT the block
// under the caret, and nothing that inserts a new one. Same list, same
// order, same icons as on the page - a button must not change meaning
// between two views of one document.
const CANVAS_ACTION_KEYS: BlockAction[] = ['heading', 'bulleted', 'numbered', 'checkbox', 'code'];
const CANVAS_ACTIONS = BLOCK_ACTIONS.filter((a) => CANVAS_ACTION_KEYS.includes(a.key));

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
// Half the bar's own height, said out loud rather than left as 999 - see
// DockFrost's `radius`.
const SHELL_RADIUS = EDITOR_TOOLBAR_HEIGHT / 2;

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
  // On the canvas the insert actions stand down. They put a NEW block
  // after the focused one, and "after" is a word the page has and the
  // canvas does not - a card has a place on a surface, and the canvas's
  // own "+" is what knows where to put one. What is left is the half
  // that acts on the card you are already typing in: undo/redo, the
  // type conversions, and the whole format row.
  canvas?: boolean;
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
  canvas,
}: Props) {
  // Same glass pill as the docDock below the block list - the
  // navigation redesign's second step, folding what used to be a flat
  // full-width bar (paper-coloured, a hard top border) into the one
  // floating capsule the Полотно dock and the select-mode bar already
  // share. It still rides the keyboard's own live height exactly as
  // before (see pinnedToolbarStyle in DocumentEditorScreen.tsx) - only
  // what it LOOKS like changed here, never how it tracks the keyboard.
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  if (!focusedBlockId) return null;

  if (activeSelection) {
    return (
      <View style={styles.shellWrap}>
        <DockFrost style={styles.shell} radius={SHELL_RADIUS} blur={false}>
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
        </DockFrost>
      </View>
    );
  }

  return (
    <View style={styles.shellWrap}>
      <DockFrost style={styles.shell} radius={SHELL_RADIUS} blur={false}>
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
            <Ionicons name="arrow-undo-outline" size={22} color={canUndo ? theme.glass.ink : theme.glass.inkMuted} />
          </Pressable>
          <Pressable
            style={styles.iconButton}
            accessibilityLabel="Повторити"
            accessibilityRole="button"
            disabled={!canRedo}
            onPress={onRedo}
          >
            <Ionicons name="arrow-redo-outline" size={22} color={canRedo ? theme.glass.ink : theme.glass.inkMuted} />
          </Pressable>
          <View style={styles.divider} />
          {(canvas ? CANVAS_ACTIONS : BLOCK_ACTIONS).map((action) => (
            <Pressable
              key={action.key}
              style={styles.iconButton}
              accessibilityLabel={action.label}
              accessibilityRole="button"
              onPress={() => onBlockAction(action.key, focusedBlockId)}
            >
              <BlockActionIcon entry={action} size={22} color={theme.glass.ink} />
            </Pressable>
          ))}
        </ScrollView>
      </DockFrost>
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
    color: t.glass.ink,
    minWidth: 20,
    textAlign: 'center',
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: t.glass.inkMuted,
    opacity: 0.4,
  },
  colorSwatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  highlightSwatch: {
    borderWidth: 1,
    borderColor: t.glass.inkMuted,
  },
});
