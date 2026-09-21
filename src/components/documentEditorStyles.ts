import { StyleSheet } from 'react-native';
import type { Theme } from '../theme/tokens';
import { GLASS_ISLAND, GLASS_TEXT, GLASS_TEXT_FAINT } from '../constants/glass';
import { NAV_BUTTON, NAV_GAP, NAV_PADDING } from '../constants/rail';
import { FONT_BOLD, FONT_EXTRABOLD, FONT_MEDIUM, FONT_MONO, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { STICKER_INK } from '../utils/documentBlocks';

// Pulled out of DocumentEditorScreen.tsx (2026-09-19), same move as
// documentBlocks.ts - this is ONE shared StyleSheet factory the screen
// itself and every block-rendering component (BlockRow, BlockList,
// TableBlockContent) call `useStyles(makeStyles)` on independently. It was
// never split by which component reads which key, and it still isn't:
// that would mean tracing every one of these ~250 keys across five files
// to find out which are shared, for no behavioural gain. Moving the whole
// factory verbatim keeps it exactly one object, in one place, however many
// files now import it.

// A permanent gap kept clear of text on the right of every paragraph/
// bulleted/numbered/checkbox block (see blockInput/blockDisplayText),
// on top of the drag-handle icon's own column. A tall, multi-line block
// used to leave only that icon's ~32px, vertically centered on the whole
// block, as a safe place to grab for a swipe - everywhere else on that
// same edge was live text, so a swipe starting a few px off would land on
// a word and start text selection (while editing) instead of scrolling.
// This reserves a wide, blank strip the full height of the block instead.
const TEXT_SWIPE_MARGIN = 24;

export const makeStyles = (t: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.paper.fill,
  },
  // The reference panel's own dock - see ReferencePanel. ~45% of the
  // screen on purpose: enough to read a row's label, not so much that
  // what lies underneath stops being a real drop target.
  referencePanelDock: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    // The LEFT edge, mirrored from where it started. The rail stands on
    // the right, so a drawer there put the app's own buttons on top of
    // the panel's - including the one that closes it, which is how the
    // drawer ended up with no way out. The user's own call: move the
    // drawer rather than move a button, "прибрати, перенести кнопку буде
    // плутанина".
    left: 0,
    width: '45%',
    minWidth: 260,
    // Android stacks by elevation before it stacks by order, and the
    // canvas this lies over raises its own pieces (its "+" sits at
    // elevation 4). Saying where this goes beats being a later sibling.
    zIndex: 30,
    elevation: 30,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Embedded (CalendarScreen): this white panel sits over the gradient
  // background, not a plain white page - rounded top corners let that
  // gradient show through the cut-away triangles instead of a hard edge.
  containerEmbedded: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  // The column the editor's own controls stand in, at the right edge -
  // the same place, width and glass as the documents screen's rail. `top`
  // comes from the safe-area inset.
  // The note's own dock had its styles here - docDock/docDockShell/
  // docDockRow/docDockItem/docDockLabel and the select face's icon
  // button, divider and count. All gone (2026-09-19): the note publishes
  // its actions and ContextDock draws them. Worth remembering WHY rather
  // than just that they went - they were sized in NAV_BUTTON/NAV_PADDING
  // points and dressed in GlassDrop, and the real dock is sized in
  // fractions of screen width and made of the tags drawer's two layers.
  // A second place to draw a dock is a second place to get both wrong.
  editorRail: {
    position: 'absolute',
    // `right` is set inline - in two panes it is the pane's edge, not the
    // window's (see railRight).
    alignItems: 'center',
    gap: 12,
  },
  exportMenuBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 5,
  },
  exportMenuPanel: {
    position: 'absolute',
    width: 200,
    overflow: 'hidden',
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 20,
    padding: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 6,
  },
  // The panel's own rows, inside the scroll view that keeps them from
  // being clipped by its ceiling.
  exportMenuScroll: {
    paddingBottom: 2,
  },
  coverSwatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  coverSwatch: {
    width: 28,
    height: 28,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  coverSwatchOn: {
    borderColor: t.accent,
  },
  coverSwatchFill: {
    flex: 1,
    borderRadius: 6,
  },
  exportMenuLabel: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    textTransform: 'uppercase',
    color: GLASS_TEXT_FAINT,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 2,
  },
  exportMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  exportMenuRule: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginVertical: 6,
  },
  exportMenuRowLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
  // A translucent-on-terracotta circle while saving, solid white once
  // saved - replaces the old "Збереження…"/"Збережено" text label
  // entirely. Diameter matches headerRight's own height so the circle and
  // the pill read as a matched pair beside each other.
  scrollArea: {
    flex: 1,
  },
  pinnedToolbar: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Centres the glass pill EditorToolbar now draws instead of the old
    // edge-to-edge bar. Nothing about `bottom` changes - that stays
    // `keyboardSV.value` alone (see pinnedToolbarStyle's own comment on
    // why an inset there once cost a gap the next block's text showed
    // through) - this only decides how its CHILD sits inside the row.
    alignItems: 'center',
  },
  // Embedded (CalendarScreen): no header and no title/tags block eating
  // the top (calendar days have neither), so the block list needs its own
  // small top breathing room instead.
  scrollAreaEmbedded: {
    paddingTop: 4,
  },
  coverImage: {
    width: '100%',
    height: 180,
  },
  titleInput: {
    // At least 2x the previous 24.
    fontSize: 48,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: t.paper.ink,
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
    backgroundColor: t.paper.fill,
  },
  blockRowSelected: {
    backgroundColor: t.paper.selected,
  },
  blockRowBoundary: {
    borderColor: t.paper.edge,
  },
  // A sticker block keeps this even when selected/boundary-highlighted -
  // it's later in the style array than both, so it wins over
  // blockRowSelected's own background.
  stickerInk: {
    color: STICKER_INK,
  },
  blockRowSticker: {
    backgroundColor: '#FBE97A',
  },
  dragHandle: {
    padding: 6,
  },
  // The handle over the active block: out of the layout, so it costs
  // the line no width, and faint enough to read as a hint rather than
  // as a control sitting on the text.
  dragHandleFloating: {
    position: 'absolute',
    right: 0,
    top: 0,
    opacity: 0.6,
  },
  // Says the recogniser is working, and how far it has got - it takes
  // seconds, and silence would read as nothing happening.
  ocrToast: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(24,21,19,0.96)',
  },
  ocrToastLabel: {
    fontSize: 14,
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
  },
  // Metrically identical to blockDisplayText (same lineHeight, no Android
  // font padding) so a block keeps its exact height when it switches
  // between plain text and the live input - any difference there shows
  // as the document twitching on every tap.
  blockInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: FONT_REGULAR,
    lineHeight: 22,
    includeFontPadding: false,
    textAlignVertical: 'top',
    color: t.paper.ink,
    paddingHorizontal: 8,
    paddingVertical: 6,
    // See TEXT_SWIPE_MARGIN.
    marginRight: TEXT_SWIPE_MARGIN,
  },
  dbRowBlock: {
    flex: 1,
  },
  blockDisplayText: {
    fontSize: 16,
    fontFamily: FONT_REGULAR,
    lineHeight: 22,
    includeFontPadding: false,
  },
  // Its own ground, so a block of code is plainly not prose.
  codeBlock: {
    backgroundColor: t.paper.tint,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.paper.edge,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  codeText: {
    fontFamily: FONT_MONO,
    fontSize: 13,
    lineHeight: 19,
  },
  codeLanguage: {
    alignSelf: 'flex-end',
    fontSize: 10,
    fontFamily: FONT_REGULAR,
    color: t.paper.inkFaint,
  },
  heading1: {
    fontSize: 26,
    lineHeight: 32,
    fontFamily: FONT_BOLD,
  },
  heading2: {
    fontSize: 21,
    lineHeight: 27,
    fontFamily: FONT_SEMIBOLD,
  },
  heading3: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: FONT_SEMIBOLD,
  },
  blockPlaceholder: {
    color: t.paper.inkFaint,
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
  checkboxBlock: {
    flex: 1,
  },
  checkboxReminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 24,
    marginTop: 2,
  },
  checkboxReminderText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: t.accent,
  },
  checkboxReminderTextEmpty: {
    color: t.paper.inkFaint,
    fontWeight: '500',
    fontFamily: FONT_MEDIUM,
  },
  bulletMark: {
    fontSize: 18,
    fontFamily: FONT_REGULAR,
    color: t.paper.ink,
    paddingLeft: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: t.paper.edge,
    marginVertical: 12,
    marginHorizontal: 4,
  },
  tableBlock: {
    flex: 1,
    gap: 6,
    paddingVertical: 4,
  },
  tableFormulaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tableFormulaRefBadge: {
    minWidth: 36,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: t.paper.tint,
    alignItems: 'center',
  },
  tableFormulaRefText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.paper.inkMuted,
  },
  tableFormulaInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.paper.ink,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: t.paper.edge,
    borderRadius: 6,
  },
  tableFormulaDoneButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 2,
  },
  tableGutterCell: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableGutterText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: t.paper.inkFaint,
  },
  tableColumnHeaderCell: {
    width: 84,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tableColumnHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.paper.inkFaint,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tableCell: {
    width: 84,
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: t.paper.edge,
    borderRadius: 6,
  },
  tableCellSelected: {
    borderColor: t.accent,
    borderWidth: 2,
    backgroundColor: t.paper.selected,
  },
  tableCellText: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: t.paper.ink,
  },
  tableRowRemove: {
    padding: 2,
  },
  tableControls: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 2,
  },
  tableControlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tableControlLabel: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: t.paper.inkMuted,
  },
  blockImageWrap: {
    flex: 1,
    height: 180,
    borderRadius: 10,
    backgroundColor: t.paper.tint,
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
  // Beside it: draw on this picture, and - held down - see it without
  // the drawing.
  imageDrawButton: {
    position: 'absolute',
    top: 6,
    right: 40,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    padding: 5,
  },
  fileBlockRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: t.paper.tint,
  },
  fileBlockTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fileBlockName: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: t.paper.ink,
  },
  fileDbButton: {
    padding: 2,
  },
  fileIconWrap: {
    position: 'relative',
  },
  fileCacheBadge: {
    position: 'absolute',
    right: -5,
    bottom: -5,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: t.paper.edge,
  },
  fileCacheBadgeMissing: {
    backgroundColor: '#DC2626',
  },
  fileCacheBadgeSpinner: {
    transform: [{ scale: 0.6 }],
  },
  attachmentStatusBox: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  attachmentStatusLabel: {
    fontSize: 11,
    fontFamily: FONT_REGULAR,
    color: t.paper.inkFaint,
  },
  linkCardVideo: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.paper.edge,
    overflow: 'hidden',
    position: 'relative',
  },
  linkDbButtonVideo: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkVideoThumbWrap: {
    width: '100%',
    height: 140,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkVideoThumb: {
    width: '100%',
    height: '100%',
  },
  linkPlayBadge: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkCardGeneric: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.paper.edge,
    overflow: 'hidden',
    position: 'relative',
  },
  linkCardGenericTap: {
    flexDirection: 'row',
  },
  linkDbButtonGeneric: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(243,244,246,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkGenericThumb: {
    width: 80,
    height: 80,
    backgroundColor: t.paper.tint,
  },
  linkCardBody: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    justifyContent: 'center',
    gap: 4,
  },
  linkCardBodyWithDbButton: {
    paddingRight: 40,
  },
  linkCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: t.paper.ink,
  },
  linkCardCaption: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: t.paper.inkFaint,
  },
  linkCardCompact: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: t.paper.tint,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  linkCardCompactTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 4,
  },
  linkDbButtonCompact: {
    padding: 6,
  },
  linkCompactIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(59,130,246,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkCompactIconGeo: {
    backgroundColor: 'rgba(22,163,74,0.12)',
  },
  linkCompactText: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: t.paper.ink,
  },
  linkPromptBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  linkPromptCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  linkPromptTitle: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#111827',
  },
  linkPromptHint: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: '#6B7280',
    lineHeight: 18,
  },
  linkPromptInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: '#111827',
  },
  linkPromptButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 4,
  },
  linkPromptCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  linkPromptCancelLabel: {
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: '#6B7280',
  },
  linkPromptSaveButton: {
    backgroundColor: t.accent,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  linkPromptSaveButtonDisabled: {
    backgroundColor: '#BFDBFE',
  },
  linkPromptSaveLabel: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
  },
  dropLine: {
    position: 'absolute',
    top: 0,
    left: 8,
    right: 8,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.accent,
  },
  addBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  addBlockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  addBlockLabel: {
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: t.paper.ink,
  },
  selectedActionsWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 100,
    alignItems: 'center',
  },
  selectedActionsCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: t.scrim,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  selectedActionsCount: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: FONT_EXTRABOLD,
    color: '#fff',
  },
  selectedActionsDivider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  selectedActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectedActionLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
  },
});
