import FlashcardBlockCard from './FlashcardBlockCard';
import { noteTextSize, useBlockFace } from '../utils/noteFont';
import DbTableBlock from './DbTableBlock';
import { ask } from './surfaces/Ask';
import { HIGHLIGHT_COLORS } from './EditorToolbar';
import { foldOf } from '../utils/toggleBlocks';
import SketchLayer from './SketchLayer';
import { INK, drawingViewBox } from '../utils/sketchGeometry';
import { rememberTableTap, useTableWide } from '../utils/tableTap';
import { finishNaming, useNamingBlock } from '../utils/docRefNaming';
import { requestBoardJump } from '../utils/boardMap';
import { ComponentProps, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  findNodeHandle,
  GestureResponderEvent,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
// Deliberately gesture-handler's ScrollView, not react-native's - see the
// same note in DocumentEditorScreen.tsx (this component moved out of that
// file on 2026-09-19).
import { GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { useRowHover } from '../hooks/useRowHover';
import { FEATURES } from '../features';
import { useDensity } from '../hooks/useDensity';
import { Ionicons } from './icons/Ionicons';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { Block, Tag } from '../types';
import { useAttachmentSource } from '../hooks/useAttachmentSource';
import { useCachedAttachment } from '../hooks/useCachedAttachment';
import { useStyles, useTextScale, useTheme } from '../theme/ThemeProvider';
import BoardPlaceSnap from './BoardPlaceSnap';
import { makeStyles, PAGE_H1, PAGE_H2, PAGE_H3, PAGE_TEXT } from './documentEditorStyles';
import { SoftCheck, SoftTaskCheck } from './SoftIcon';
import { softCursor, softTokens } from '../theme/soft';
import type { colorForDocument } from '../utils/documentColor';
import { caretIndexFromDom } from '../utils/caretAtPoint';
import { canPlaceCaretByTouch, measureNode } from '../utils/measureNode';
import { displayIndexForTouch } from '../utils/caretFromTextLayout';
import { autoGrowInput } from '../utils/autoGrowInput';
import {
  applyDisplayEdit,
  fileIconColorFor,
  fileIconFor,
  formatReminderBadge,
  parseFormattedText,
  plainTextOf,
  displayWithLinkGlyphs,
  displayWithNestedGlyphs,
  LINK_GLYPH,
  NESTED_GLYPH,
  noteLinkSpans,
  STICKER_INK,
  type TextLayoutLine,
  bulletFor,
  alignStyleOf,
  indentOf,
  INDENT_STEP,
} from '../utils/documentBlocks';
import FormattedText from './FormattedText';
import { setSelection } from '../utils/setSelection';
import { withAlpha } from '../utils/color';
import { attachChipField, CHIP_MARK_ALPHA, supportsChipSpans } from '../utils/mindevaNative';
import TableBlockContent from './TableBlockContent';
import CustomRowBlockCard from './CustomRowBlockCard';
import LiveDocumentCard from './LiveDocumentCard';
import type { DocumentIndex } from '../hooks/useDocumentIndex';

const EMPTY_DOCUMENT_INDEX: DocumentIndex = new Map();
import CustomDatabaseViewBlockCard from './CustomDatabaseViewBlockCard';
import { PreviewDepthContext } from './previewDepth';

// Pulled out of DocumentEditorScreen.tsx (2026-09-19), which had grown to
// 6883 lines. This is a plain, prop-only component - it never closed over
// the screen's own state, so the move changes no behaviour. Dragging is
// handled by the wrapping SortableBlockRow, not in here.
type BlockRowProps = {
  item: Block;
  // The daily note in the calendar draws no drag handles: its sheet runs
  // the full width and passes under the rail, so a column of handles
  // would sit beneath the buttons. Dragging still works - the whole row
  // is the drag target, the handle was only ever a sign that it is.
  hideHandle?: boolean;
  // At a pointer: what dragging the handle does (move the block, or the
  // picked group) - built by the sortable row, which knows the list.
  handleGesture?: ComponentProps<typeof GestureDetector>['gesture'];
  // Under a toggle's section - see BlockList's own `indented` computation.
  indented?: boolean;
  // A toggle's frame, row by row (BlockList): the title is the head (or solo when nothing is under it), what it holds is body, the last
  // row is the foot; foldHint = a closed toggle's faint first line.
  toggleRole?: 'solo' | 'head' | 'body' | 'foot';
  foldHint?: string;
  isSelected: boolean;
  isSelectMode: boolean;
  // Only the one block being written in is a live TextInput - every other
  // block is plain Text a swipe scrolls straight through, and a tap on it
  // calls onActivate to make it the live one. This replaces the old
  // whole-document edit mode (the pencil button): Android can't let a
  // TextInput and a scroll gesture share a touch, so the way to have both
  // is to only ever have one TextInput on screen.
  isActive: boolean;
  showBoundary: boolean;
  listNumber?: number;
  // A search query to mark in yellow while this block is not being
  // edited - the search results' page miniatures, and a note opened
  // from a search result.
  searchHighlight?: string;
  // Which of this block's matches the search stands on (see FormattedText's searchCurrent).
  searchCurrent?: number;
  textVersion: number;
  // cursorIndex: DISPLAY-text position to place the cursor at (from a tap on
  // the locked text); omitted = end of the text.
  onActivate: (id: string, cursorIndex?: number) => void;
  // A wide table dragged past its right end and let go: pick this block (the same as a swipe left on a block that fits).
  onPullSelect?: () => void;
  onBlur: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onToggleChecked: (id: string) => void;
  onOpenReminder: (id: string) => void;
  onUpdateBlock: (id: string, patch: Partial<Block>) => void;
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
  // A "04:32" in this block's text was tapped (see FormattedText).
  onTimecode?: (blockId: string, seconds: number) => void;
  // A note link in the text: opened by a tap at rest, its menu on a hold -
  // or on a tap while the block is being typed (the caret is put after it).
  onNoteLink?: (documentId: string) => void;
  onNoteLinkMenu?: (blockId: string, documentId: string, label: string) => void;
  // A link to a note nested in this one - drawn with the arrow down.
  isNestedLink?: (ref: string) => boolean;
  onOpenSketch: (id: string) => void;
  // 'dbRow' blocks only - the full tag list (the card filters it by the
  // live row's own tagIds) and "open this row in its database".
  allTags: Tag[];
  onOpenCustomRow: (databaseId: string, rowId: string) => void;
  // 'docRef' blocks only - every document, reduced to what it takes to
  // draw one (see useDocumentIndex), and where a tap on the card goes.
  documentIndex?: DocumentIndex;
  onOpenDocument?: (documentId: string) => void;
  // 'dbView' blocks only - "open this view's own database, with that view
  // applied" (tapping the block's header, as opposed to one of its rows).
  onOpenCustomView: (databaseId: string, viewId: string) => void;
  inputRef: (ref: TextInput | null) => void;
  // Drawn inside a page miniature: no attachment checks, no live cards
  // (see the still plate below) - the same look for a fraction of the work.
  preview?: boolean;
  softInputDisabled?: boolean;
  // null when "Колір паперу" is off, OR for a sticker block specifically -
  // a sticker keeps its own yellow/dark treatment regardless of the
  // document's paper color (see the isSticker comment in types.ts).
  paperColor: ReturnType<typeof colorForDocument> | null;
};

// A word linking to a note, at rest: blue, as links are read everywhere.
export const LINK_BLUE = '#2563EB';
export const LINK_BLUE_DARK = '#60A5FA';

export default function BlockRow({
  item,
  hideHandle,
  handleGesture,
  indented,
  toggleRole,
  foldHint,
  isSelected,
  isSelectMode,
  isActive,
  showBoundary,
  listNumber,
  searchHighlight,
  searchCurrent,
  textVersion,
  onActivate,
  onPullSelect,
  onBlur,
  onChangeText,
  onBackspaceEmpty,
  onToggleSelected,
  onToggleChecked,
  onOpenReminder,
  onUpdateBlock,
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
  onTimecode,
  onNoteLink,
  onNoteLinkMenu,
  isNestedLink,
  onOpenSketch,
  allTags,
  onOpenCustomRow,
  documentIndex,
  onOpenDocument,
  onOpenCustomView,
  inputRef,
  preview,
  softInputDisabled,
  paperColor,
}: BlockRowProps) {
  const theme = useTheme();
  const previewDepth = useContext(PreviewDepthContext);
  const styles = useStyles(makeStyles);
  // Outside edit mode (or while selecting), the text field is completely
  // inert to touch (pointerEvents: 'none') rather than merely
  // non-editable - a TextInput that can still receive touches keeps
  // claiming them for cursor placement even when non-editable, which is
  // exactly what was blocking swipe-to-scroll over blocks. With no
  // TextInput to compete with, a swipe anywhere reaches the ScrollView
  // just like it already did over the icon column.
  const canEditText = isActive && !isSelectMode;
  const tableBoxRef = useRef({ width: 0, height: 0 });
  // A table wider than its place scrolls itself even locked (see TableBlockContent): its cells take the taps then, and the wrapper lets touches through.
  const tableWide = useTableWide(item.type === 'table' ? item.id : '');
  // A note just made from chosen blocks asks for its name in its own card (utils/docRefNaming) - on the page, not in a preview.
  const naming = useNamingBlock(item.type === 'docRef' && !preview ? item.id : '');

  // THE FORMATTING WHILE TYPING (features.liveFormat): the field's text as styled runs - the block's own runs, so the
  // field shows what the block shows at rest. Not for code (never parsed) nor an empty block. A link to a note nested
  // in this one wears its own arrow, as the plain field's text does (displayWithNestedGlyphs). Memoised on the text:
  // runs rebuilt on every render handed the field its text anew each time, and that dropped a selection (opening the
  // panel under the keyboard re-renders the row - the user: «скидається виділення тексту»).
  const blockType = item.type ?? 'paragraph';
  // The note's own face (utils/noteFont), none for code (it keeps its mono) and none for the app's own.
  const noteFaces = useBlockFace(item.font);
  const noteFace = noteFaces && blockType !== 'code' ? { fontFamily: blockType === 'heading' ? noteFaces.strong : noteFaces.regular } : null;
  const liveRuns = useMemo(
    () =>
      // Native only: RN-web's field draws no children and, with no value, stood EMPTY under the caret (the Mac note and the
      // board's card window showed a blank field, the caret at 0, Enter splitting nothing - 2026-10-20).
      Platform.OS !== 'web' && canEditText && FEATURES.liveFormat && blockType !== 'code' && (item.text ?? '') !== ''
        ? parseFormattedText(item.text).map((seg) =>
            seg.noteLink && isNestedLink?.(seg.noteLink) && seg.text.startsWith(LINK_GLYPH)
              ? { ...seg, text: NESTED_GLYPH + seg.text.slice(LINK_GLYPH.length) }
              : seg
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEditText, blockType, item.text]
  );
  // A note link while typing: the chip's own blue on its own tint. Android draws a run's background as a square box
  // hugging its letters; an APK with ChipSpans (utils/mindevaNative) draws a run marked with CHIP_MARK_ALPHA as the
  // rounded chip instead, CHIP_LOOK.padX wider at each side - over the spaces around it, the text's widths untouched
  // (so the words beside a link stand a little closer than beside the chip at rest). Making real room with letter
  // spacing was tried and dropped (2026-10-19): Android ignored it on the arrow, and splitting the link into pieces
  // gave each piece its own chip. The link stays ONE run.
  const roundChips = supportsChipSpans && liveRuns?.some((seg) => !!seg.noteLink) === true;
  const linkInkLive = theme.scheme === 'dark' ? LINK_BLUE_DARK : LINK_BLUE;
  const linkTintLive = roundChips
    ? linkInkLive + CHIP_MARK_ALPHA.toString(16).padStart(2, '0')
    : withAlpha(linkInkLive, 0.14);
  const liveChildren = useMemo(() => {
    if (!liveRuns) return undefined;
    const out: ReactNode[] = [];
    liveRuns.forEach((seg, i) => {
      const decorations = [seg.underline && 'underline', seg.strikethrough && 'line-through'].filter(Boolean).join(' ');
      const style = {
        fontWeight: (seg.bold ? '700' : seg.noteLink ? '600' : '400') as '700' | '600' | '400',
        fontStyle: (seg.italic ? 'italic' : 'normal') as 'italic' | 'normal',
        textDecorationLine: (decorations || 'none') as 'none' | 'underline' | 'line-through',
        color: seg.color ?? (seg.noteLink ? linkInkLive : undefined),
        backgroundColor: seg.highlight ?? (seg.noteLink ? linkTintLive : undefined),
      };
      out.push(
        <Text key={i} style={style}>
          {seg.text}
        </Text>
      );
    });
    return out;
  }, [liveRuns, linkInkLive, linkTintLive]);
  // The last selection the field reported, put back when the panel under the keyboard opens or closes: the field is
  // re-rendered then, and Android let a selected RANGE collapse (bold, colour then had nothing to act on).
  const lastSelectionRef = useRef<{ start: number; end: number } | null>(null);
  // For the note-link caret rule (onSelectionChange): when a letter was last typed, and the text as it now stands.
  const typedAtRef = useRef(0);
  // When a finger last touched the field, and the last caret place outside every link (which way the caret was going).
  const touchedAtRef = useRef(0);
  const outsideCaretRef = useRef<number | null>(null);
  const latestTextRef = useRef(item.text ?? '');
  latestTextRef.current = item.text ?? '';
  // The panel blurs the field to take the keyboard down, and a blurred field draws no selection. Once the keyboard
  // is gone and the field no longer asks for one (showSoftInputOnFocus off), focus comes back WITHOUT a keyboard
  // and the picked words are lit again.
  useEffect(() => {
    const sel = lastSelectionRef.current;
    if (!canEditText || softInputDisabled !== true || !sel || sel.start === sel.end) return;
    const t = setTimeout(() => {
      localInputRef.current?.focus();
      setSelection(localInputRef.current, sel.start, sel.end);
    }, 380);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [softInputDisabled]);

  // "Розмір тексту" - the reading scale, applied here rather than baked
  // into `styles.blockInput`/`heading1..3`: those come from a
  // theme-only `useStyles` factory, and a note's own body is exactly
  // the flexible, multi-line surface the user's own plan named first -
  // "починаємо з текстів для читання". A heading keeps its OWN base
  // size scaled, not the paragraph's, or the level would collapse into
  // paragraph text at anything but 1x.
  const textScale = useTextScale();
  const scaledTextStyle = (() => {
    // The sizes themselves live beside the styles (PAGE_* in
    // documentEditorStyles) - one copy, not two that can disagree.
    const base =
      (item.type ?? 'paragraph') === 'heading'
        ? item.headingLevel === 1
          ? PAGE_H1
          : item.headingLevel === 3
            ? PAGE_H3
            : PAGE_H2
        : PAGE_TEXT;
    // A face with small lowercase (the handwriting) is set larger, its lines a little less so (utils/noteFont).
    if (blockType === 'code') return { fontSize: Math.round(base.size * textScale), lineHeight: Math.round(base.line * textScale) };
    return noteTextSize(base.size, base.line, textScale, noteFaces);
  })();

  // Kept alongside the ref the screen collects, purely so the field can be
  // grown to its text - see autoGrowInput. On a phone this effect does
  // nothing at all; in a browser it is the difference between a block and
  // a two-line window with the rest of the block scrolled away inside it.
  const localInputRef = useRef<TextInput | null>(null);
  // The field is named to the APK once per field (a block's field is made anew when it becomes the active one): the
  // tag differs, and only then is it sent.
  const chipFieldTagRef = useRef<number | null>(null);
  useEffect(() => {
    if (!roundChips) return;
    const tag = findNodeHandle(localInputRef.current);
    if (tag == null || tag === chipFieldTagRef.current) return;
    chipFieldTagRef.current = tag;
    attachChipField(tag);
  }, [roundChips, liveRuns]);
  useEffect(() => {
    autoGrowInput(localInputRef.current);
  }, [item.text, canEditText]);

  const type = item.type ?? 'paragraph';
  // A sticker keeps its own yellow regardless of the document's paper
  // color - see BlockRowProps.paperColor.
  const rowPaperColor = item.isSticker ? null : paperColor;

  // A file/image block only ever stores a local URI - Android can purge app
  // cache under storage pressure, and a different device never had it in
  // the first place. useCachedAttachment checks on each mount (not just
  // trusting that attaching it once succeeded) and quietly re-downloads
  // from the Drive backup when there is one, so the badge below is an
  // honest confirmation rather than a decoration that's still green after
  // the file is actually gone.
  const fileCacheStatus = useCachedAttachment(type === 'file' ? item.fileUri : undefined, item.driveFileId, true, !preview);
  // Through useAttachmentSource, not useCachedAttachment, because the
  // picture needs an ADDRESS and not just a verdict. On the phone the two
  // are the same thing - the stored path is where the bytes are, once the
  // Drive copy has been pulled back into it. In a browser it can never be:
  // that path is a file on the phone, which a page may not open, so the
  // web half fetches the Drive copy and hands back a blob the page can
  // actually show. Same hook, same call, one truth per platform.
  // While a finger is held on the brush the drawing steps aside - the
  // "show the original" the user asked for, which costs nothing because
  // the picture was never drawn on in the first place.
  const [showingOriginal, setShowingOriginal] = useState(false);
  // Three levels, each a step down from the one above. A heading with no
  // level stored is a level two - what one typed rather than pasted is.
  const headingStyle =
    (item.type ?? 'paragraph') === 'heading'
      ? item.headingLevel === 1
        ? styles.heading1
        : item.headingLevel === 3
          ? styles.heading3
          : styles.heading2
      : null;
  // The shape the drawing was made against, which is the picture's own -
  // see SketchEditor's background canvas.
  const drawnAspect =
    item.sketchElements?.length && item.sketchWidth && item.sketchHeight
      ? item.sketchWidth / item.sketchHeight
      : null;
  const { status: imageCacheStatus, source: imageSource } = useAttachmentSource(
    type === 'image' ? item.imageUri : undefined,
    item.driveFileId,
    true,
    !preview
  );

  // Tap-to-cursor on the locked text (see displayIndexForTouch): the Text's
  // line layout, and the Text itself to turn the tap's page coordinates
  // into coordinates inside it.
  const lockedTextRef = useRef<Text>(null);
  const lockedLinesRef = useRef<TextLayoutLine[]>([]);
  // How wide a line of this block is - what a note link's chip may not
  // outgrow (a view in a line cannot wrap; too long, it ran off the page).
  const [lineWidth, setLineWidth] = useState(0);
  async function activateAtTouch(e: GestureResponderEvent) {
    const { pageX, pageY } = e.nativeEvent;
    const textNode = lockedTextRef.current;
    if (!textNode || !item.text) {
      onActivate(item.id);
      return;
    }
    // A browser can be asked outright which character the click landed
    // on, and it answers without any of the measuring below. That is what
    // makes the FIRST click place the cursor here rather than merely
    // waking the block up. A display index, not raw - the active field's
    // own cursor is always in display terms now (see cursorIndex on
    // onActivate), so this is handed over as-is, no conversion needed.
    const fromDom = caretIndexFromDom(textNode, pageX, pageY);
    if (fromDom !== null) {
      onActivate(item.id, outOfLinks(fromDom));
      return;
    }
    if (!canPlaceCaretByTouch) {
      onActivate(item.id);
      return;
    }
    const box = await measureNode(textNode);
    if (!box) {
      onActivate(item.id);
      return;
    }
    const displayText = plainTextOf(item.text);
    const displayIndex = displayIndexForTouch(
      lockedLinesRef.current,
      displayText,
      pageX - box.x,
      pageY - box.y
    );
    onActivate(item.id, outOfLinks(displayIndex));
  }
  // A tap never puts the caret INSIDE a word linking to a note (the user, 2026-10-25: a line holding only such a word -
  // a card turned «словом» - could not be written in: a tap beside the word measured into it, and a caret inside a link
  // opens its menu instead of typing). It lands AFTER the word: the word is drawn as an inline chip the text layout does
  // not measure, so a tap beside it reads as somewhere in its middle (seen: a tap right of the chip gave index 4 of 3-23),
  // and a tap on the chip itself never gets here - it opens the note.
  function outOfLinks(index: number): number {
    for (const span of noteLinkSpans(item.text ?? '')) {
      if (index > span.displayStart && index < span.displayEnd) return span.displayEnd;
    }
    return index;
  }

  // A pointer's rows: the handle shows where the pointer is (and only there) - see below. Read here, before the
  // content, because a task's empty reminder line follows the hover too.
  const pointer = useDensity() === 'pointer';
  const [hoverRef, hover] = useRowHover();
  let content: ReactNode;
  if (type === 'divider') {
    // Three looks, one block type - see Block.dividerStyle. A 'break'
    // already saved in a note draws as the plain line until the real
    // page break exists: kept in the data, so those notes get the real
    // thing the day it does, rather than losing where the cuts were.
    const style = item.dividerStyle ?? 'solid';
    content =
      style === 'dotted' ? (
        // Drawn, not bordered: a single-sided dotted border is
        // unreliable on Android, a dashed SVG line is the same
        // everywhere.
        <View style={styles.dividerDottedWrap}>
          <Svg height={3} width="100%">
            <Line
              x1="1"
              y1="1.5"
              x2="100%"
              y2="1.5"
              stroke={styles.dividerLine.backgroundColor as string}
              strokeWidth={2}
              strokeDasharray="1 7"
              strokeLinecap="round"
            />
          </Svg>
        </View>
      ) : (
        <View style={[styles.dividerLine, style === 'bold' && styles.dividerBold]} />
      );
  } else if (type === 'image') {
    // 'contain' keeps the photo's real proportions, with any leftover space
    // in the fixed-height box showing the box's own pale gray background
    // instead of cropping the image; 'cover' fills the box entirely,
    // cropping whatever doesn't fit. The small corner button switches
    // between the two per image.
    const fit = item.imageFit ?? 'contain';
    content = !item.imageUri ? (
      <Text style={styles.blockPlaceholder}>Немає зображення</Text>
    ) : imageCacheStatus === 'restoring' || imageCacheStatus === 'checking' ? (
      <View style={[styles.blockImageWrap, styles.attachmentStatusBox]}>
        <ActivityIndicator color="#9CA3AF" />
        {imageCacheStatus === 'restoring' && <Text style={styles.attachmentStatusLabel}>Відновлення з Диску…</Text>}
      </View>
    ) : imageCacheStatus === 'missing' ? (
      <View style={[styles.blockImageWrap, styles.attachmentStatusBox]}>
        <Ionicons name="cloud-offline-outline" size={22} color="#9CA3AF" />
        <Text style={styles.attachmentStatusLabel}>Недоступно на цьому пристрої</Text>
      </View>
    ) : (
      // A picture carrying a drawing takes the PICTURE's own shape here,
      // and is shown whole: the drawing was laid out against that shape,
      // so a box of any other proportion (the fixed 180 every other image
      // block stands in) would slide the two apart. Without a drawing
      // nothing changes.
      <View style={[styles.blockImageWrap, drawnAspect ? { height: undefined, aspectRatio: drawnAspect } : null]}>
        <Pressable
          disabled={isSelectMode}
          onPress={() => onOpenImage(item.id)}
          style={styles.blockImageTap}
        >
          <Image
            source={{ uri: imageSource ?? item.imageUri }}
            style={styles.blockImage}
            resizeMode={drawnAspect ? 'cover' : fit}
          />
          {/* The drawing, over the picture and never inside it - the same
              elements the editor holds and the same box, so a stroke sits
              where it was put, here and in a PDF. Held down, it lifts:
              that IS "show the original", and it costs no second file. */}
          {!!item.sketchElements?.length && !showingOriginal && (
            <Svg
              style={StyleSheet.absoluteFill}
              viewBox={`0 0 ${item.sketchWidth || 1} ${item.sketchHeight || 1}`}
              preserveAspectRatio="none"
              pointerEvents="none"
            >
              <SketchLayer elements={item.sketchElements} ink={INK} />
            </Svg>
          )}
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
        {!isSelectMode && (
          <Pressable
            hitSlop={8}
            style={styles.imageDrawButton}
            onPress={() => onDrawOverImage(item.id)}
            // Held: the drawing steps aside for as long as the finger
            // stays down, and comes back when it lifts.
            onLongPress={() => setShowingOriginal(true)}
            onPressOut={() => setShowingOriginal(false)}
            delayLongPress={250}
          >
            <Ionicons
              name={item.sketchElements?.length ? 'eye-off-outline' : 'brush-outline'}
              size={16}
              color="#fff"
            />
          </Pressable>
        )}
      </View>
    );
  } else if (type === 'sketch') {
    // On the note's own paper, no well of its own, and CROPPED to what is
    // drawn plus a small margin: the block is as tall as the drawing, not
    // as the screen it was drawn on (sketchGeometry's drawingViewBox).
    const elements = item.sketchElements ?? [];
    const box = drawingViewBox(elements);
    const sketchInk = item.isSticker ? STICKER_INK : (rowPaperColor?.text ?? theme.paper.ink);
    content = (
      <Pressable
        disabled={isSelectMode}
        onPress={() => onOpenSketch(item.id)}
        style={box ? [styles.sketchWrap, { aspectRatio: box.aspect }] : styles.blockImageWrap}
      >
        {box ? (
          <Svg width="100%" height="100%" viewBox={box.viewBox}>
            <SketchLayer elements={elements} ink={sketchInk} />
          </Svg>
        ) : (
          <Text style={styles.blockPlaceholder}>Порожній малюнок</Text>
        )}
      </Pressable>
    );
  } else if (type === 'table') {
    const table = (
      <TableBlockContent
        block={item}
        canEdit={canEditText}
        onUpdate={(patch) => onUpdateBlock(item.id, patch)}
        onPullSelect={onPullSelect}
        onWakeAt={(r, c, scrollX) => {
          if (isSelectMode) return onToggleSelected(item.id);
          rememberTableTap({ blockId: item.id, x: NaN, y: NaN, ...tableBoxRef.current, cell: { r, c }, scrollX });
          onActivate(item.id);
        }}
      />
    );
    // Locked, the table is display-only that a swipe scrolls through (its
    // cells are inert to touch); a tap wakes it for editing, same as text.
    content = canEditText ? (
      table
    ) : (
      <Pressable
        onLayout={(e) => {
          tableBoxRef.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
        }}
        onPress={(e) => {
          if (isSelectMode) return onToggleSelected(item.id);
          // See utils/tableTap: the live table needs to know which cell this tap was for.
          // Phone: locationX/Y. The browser's press event has no such fields, its MouseEvent carries offsetX/Y.
          const ne = e.nativeEvent as unknown as { locationX?: number; locationY?: number; offsetX?: number; offsetY?: number };
          rememberTableTap({ blockId: item.id, x: ne.locationX ?? ne.offsetX ?? NaN, y: ne.locationY ?? ne.offsetY ?? NaN, ...tableBoxRef.current });
          onActivate(item.id);
        }}
      >
        {/* The same wrapper either way: a different one would build the table anew each time the flag flips. */}
        <View pointerEvents={tableWide ? 'auto' : 'none'}>{table}</View>
      </Pressable>
    );
  } else if (type === 'file') {
    // fileCacheStatus 'restoring' means it was missing locally but is being
    // quietly re-pulled from its Drive backup right now (useCachedAttachment) -
    // 'missing' means either that failed or there never was a backup, in
    // which case opening/downloading it can't work until the device that
    // still has it re-syncs.
    content = (
      <View style={styles.fileBlockRow}>
        <Pressable
          disabled={isSelectMode || fileCacheStatus !== 'ready'}
          onPress={() => onOpenFile(item.id)}
          style={styles.fileBlockTap}
        >
          <View style={styles.fileIconWrap}>
            <Ionicons name={fileIconFor(item.fileName)} size={22} color={fileIconColorFor(item.fileName)} />
            {fileCacheStatus === 'restoring' || fileCacheStatus === 'checking' ? (
              <View style={styles.fileCacheBadge}>
                <ActivityIndicator size="small" color="#fff" style={styles.fileCacheBadgeSpinner} />
              </View>
            ) : (
              <View style={[styles.fileCacheBadge, fileCacheStatus === 'missing' && styles.fileCacheBadgeMissing]}>
                <Ionicons name={fileCacheStatus === 'ready' ? 'checkmark' : 'close'} size={9} color="#fff" />
              </View>
            )}
          </View>
          <Text style={styles.fileBlockName} numberOfLines={1}>
            {/* The name the user gave it, not the name it arrived with.
                This showed fileName - "IMG-20250910-WA0002.jpg" - even
                after being renamed in the Files database, so the rename
                was invisible everywhere except that one screen. Same
                order the quick look already uses. */}
            {item.fileTitle || item.fileName || 'Файл'}
          </Text>
          {fileCacheStatus === 'missing' && <Text style={styles.attachmentStatusLabel}>Недоступно тут</Text>}
        </Pressable>
        {!isSelectMode && (
          <>
            <Pressable hitSlop={8} onPress={onOpenFileDatabase} style={styles.fileDbButton}>
              <Ionicons name="server-outline" size={16} color="#6B7280" />
            </Pressable>
            {fileCacheStatus === 'ready' && (
              <Pressable hitSlop={8} onPress={() => onDownloadFile(item.id)}>
                <Ionicons name="download-outline" size={18} color="#6B7280" />
              </Pressable>
            )}
          </>
        )}
      </View>
    );
  } else if (type === 'link') {
    // Three visual variants (matching the approved mockup): a big-thumbnail
    // YouTube/TikTok card with a play badge, a smaller side-thumbnail
    // generic card, and a compact icon-only card when there's no preview
    // image (geo links, or any fetch that came back empty). Each variant is
    // an outer View holding two SIBLING Pressables (not one nested inside
    // the other, same trick as the image block's corner buttons) - the main
    // one opens the URL, the small "database" icon jumps to this link's
    // entry in its Links database screen instead.
    const url = item.linkUrl ?? item.text;
    const isVideo = (item.linkSiteName ?? '').includes('YouTube') || (item.linkSiteName ?? '').includes('TikTok');
    const isGeo = item.linkSiteName === 'Геоточка';
    if (isVideo && item.linkImageUrl) {
      content = (
        <View style={styles.linkCardVideo}>
          <Pressable disabled={isSelectMode} onPress={() => onOpenLink(url)}>
            <View style={styles.linkVideoThumbWrap}>
              <Image source={{ uri: item.linkImageUrl }} style={styles.linkVideoThumb} resizeMode="cover" />
              <View style={styles.linkPlayBadge}>
                <Ionicons name="play" size={18} color="#fff" />
              </View>
            </View>
            <View style={styles.linkCardBody}>
              <Text style={styles.linkCardTitle} numberOfLines={2}>
                {item.linkTitle || url}
              </Text>
              {!!item.linkSiteName && (
                <Text style={styles.linkCardCaption} numberOfLines={1}>
                  {item.linkSiteName}
                </Text>
              )}
            </View>
          </Pressable>
          {!isSelectMode && (
            <Pressable
              hitSlop={6}
              style={styles.linkDbButtonVideo}
              onPress={() => onOpenLinkDatabase(item)}
            >
              <Ionicons name="server-outline" size={14} color="#fff" />
            </Pressable>
          )}
        </View>
      );
    } else if (item.linkImageUrl) {
      content = (
        <View style={styles.linkCardGeneric}>
          <Pressable disabled={isSelectMode} onPress={() => onOpenLink(url)} style={styles.linkCardGenericTap}>
            <Image source={{ uri: item.linkImageUrl }} style={styles.linkGenericThumb} resizeMode="cover" />
            <View style={[styles.linkCardBody, styles.linkCardBodyWithDbButton]}>
              <Text style={styles.linkCardTitle} numberOfLines={2}>
                {item.linkTitle || url}
              </Text>
              {!!item.linkSiteName && (
                <Text style={styles.linkCardCaption} numberOfLines={1}>
                  {item.linkSiteName}
                </Text>
              )}
            </View>
          </Pressable>
          {!isSelectMode && (
            <Pressable
              hitSlop={6}
              style={styles.linkDbButtonGeneric}
              onPress={() => onOpenLinkDatabase(item)}
            >
              <Ionicons name="server-outline" size={14} color="#6B7280" />
            </Pressable>
          )}
        </View>
      );
    } else {
      content = (
        <View style={styles.linkCardCompact}>
          <Pressable disabled={isSelectMode} onPress={() => onOpenLink(url)} style={styles.linkCardCompactTap}>
            <View style={[styles.linkCompactIcon, isGeo && styles.linkCompactIconGeo]}>
              <Ionicons name={isGeo ? 'location-outline' : 'link-outline'} size={18} color={isGeo ? '#16A34A' : theme.accent} />
            </View>
            <Text style={styles.linkCompactText} numberOfLines={1}>
              {item.linkTitle || item.linkSiteName || url}
            </Text>
          </Pressable>
          {!isSelectMode && (
            <Pressable hitSlop={6} onPress={() => onOpenLinkDatabase(item)} style={styles.linkDbButtonCompact}>
              <Ionicons name="server-outline" size={16} color="#9CA3AF" />
            </Pressable>
          )}
        </View>
      );
    }
  } else if (preview && previewDepth > 1 && (type === 'dbRow' || type === 'flashcard' || type === 'docRef' || type === 'dbView')) {
    // A miniature inside a miniature: the card is a still plate with its
    // name (see previewDepth). One level down, cards are themselves.
    content = (
      <View style={styles.dbRowBlock}>
        <View style={[previewEmbedStyles.plate, { borderColor: theme.paper.edge, backgroundColor: theme.paper.tint }]}>
          <Ionicons
            name={type === 'docRef' ? 'document-text-outline' : type === 'flashcard' ? 'albums-outline' : 'server-outline'}
            size={18}
            color={theme.paper.inkMuted}
          />
          <Text style={[previewEmbedStyles.title, { color: theme.paper.ink }]} numberOfLines={1}>
            {(type === 'docRef'
              ? item.docRefTitle
              : type === 'flashcard'
                ? item.flashcardTerm
                : type === 'dbRow'
                  ? item.dbRowTitle
                  : item.dbViewTitle) || '…'}
          </Text>
        </View>
      </View>
    );
  } else if (type === 'dbRow') {
    // A row of a user-created database, rendered LIVE from that database
    // (see CustomRowBlockCard) rather than from anything stored on the
    // block - the whole point of embedding a record instead of copying its
    // text. In select mode the card is inert so a tap selects the block.
    content = (
      <View style={styles.dbRowBlock} pointerEvents={isSelectMode ? 'none' : 'auto'}>
        <CustomRowBlockCard
          databaseId={item.dbRowDatabaseId}
          rowId={item.id}
          fallbackTitle={item.dbRowTitle}
          tags={allTags}
          onOpen={onOpenCustomRow}
        />
      </View>
    );
  } else if (type === 'flashcard') {
    // A flashcard from «Картки», live - its explanation folds open right
    // here in the note. Inert in select mode so a tap selects the block.
    content = (
      <View style={styles.dbRowBlock} pointerEvents={isSelectMode ? 'none' : 'auto'}>
        <FlashcardBlockCard block={item} variant="note" />
      </View>
    );
  } else if (type === 'docRef') {
    // Another document, as a card. Live from the document index, so a
    // note renamed anywhere is renamed here - the same choice 'dbRow'
    // makes just below. Inert in select mode so a tap selects the block
    // instead of navigating away from it.
    content = (
      <View style={styles.dbRowBlock} pointerEvents={isSelectMode ? 'none' : 'auto'}>
        <LiveDocumentCard
          documentId={item.docRefId}
          fallbackTitle={item.docRefTitle}
          index={documentIndex ?? EMPTY_DOCUMENT_INDEX}
          tags={allTags}
          onOpen={(id) => onOpenDocument?.(id)}
          editTitle={naming ? { onDone: (title) => finishNaming(item.id, title) } : undefined}
        />
      </View>
    );
  } else if (type === 'dbTable') {
    // A table of a base's records, every setting its own (DbTableBlock).
    content = (
      <View style={styles.dbRowBlock}>
        <DbTableBlock block={item} disabled={isSelectMode} onUpdate={(patch) => onUpdateBlock(item.id, patch)} onOpenRow={onOpenCustomRow} />
      </View>
    );
  } else if (type === 'dbView') {
    // A saved view of a user-created database, rendered LIVE (see
    // CustomDatabaseViewBlockCard) - the rows shown are whichever ones
    // currently match the view's filter, not a list fixed at insert time.
    content = (
      <View style={styles.dbRowBlock} pointerEvents={isSelectMode ? 'none' : 'auto'}>
        <CustomDatabaseViewBlockCard
          databaseId={item.dbViewDatabaseId}
          viewId={item.id}
          fallbackTitle={item.dbViewTitle}
          tags={allTags}
          onOpenRow={onOpenCustomRow}
          onOpenView={onOpenCustomView}
        />
      </View>
    );
  } else {
    const textField = canEditText ? (
      <TextInput
        // Never Android's full-screen "extract" editor (a bare field and a
        // «Готово» button over the whole app) - the unfolded Fold is
        // landscape and short enough for Android to choose it, which hid
        // the card window and the note behind it (2026-10-08).
        disableFullscreenUI
        {...({ dataSet: { noteblock: '1' } } as object)}
        // The panel that stands where the keyboard was needs this field
        // to KEEP FOCUS while the keyboard is gone - otherwise the text
        // selection goes with it, and bold/italic/colour have nothing to
        // act on. showSoftInputOnFocus does exactly that: the caret and
        // the selection stay, only the soft keyboard steps aside.
        // `undefined`, not `true`, when the panel is closed. Setting
        // this prop at all makes Android's TextInput call
        // setShowSoftInputOnFocus on every update, and that nudged the
        // IME - the page jerked twice on a plain tap into a field.
        // Absent, RN does not touch it and the field behaves exactly as
        // it did before the panel existed.
        showSoftInputOnFocus={softInputDisabled === undefined ? undefined : !softInputDisabled}
        // Android's TextInput doesn't reliably pick up a dynamic `editable`
        // change on an already-mounted view; keying on canEditText forces
        // a clean remount so the native EditText is created with the
        // correct editable/pointerEvents state instead of getting stuck
        // non-editable. textVersion is folded in too - see its declaration
        // for why (avoids a transient grow/shrink flicker on Enter-split).
        key={`editable-${textVersion}`}
        ref={(node) => {
          localInputRef.current = node;
          inputRef(node);
          // On mount too, not only on the effect above: the field is
          // created already holding the whole block's text.
          autoGrowInput(node);
        }}
        // Mount-time focus is what reliably raises the keyboard on Android;
        // this input only ever mounts as the active block, so that's exactly
        // when it should. The screen's focus effect still places the cursor.
        autoFocus
        // Marker-free while it is being typed - the same string the
        // locked block has always shown (plainTextOf). A code block is
        // the one exception: nothing in it is ever parsed, so it keeps
        // showing its own raw text untouched.
        // THE FORMATTING WHILE TYPING (features.liveFormat, a trial 2026-10-19): the field is handed its text as
        // styled runs instead of one plain string - the same runs the block shows at rest, so what is on screen does
        // not change, only how it looks. RN refuses value AND children together, so with the runs there is no value.
        value={
          liveRuns
            ? undefined
            : type === 'code'
              ? item.text
              : isNestedLink
                ? displayWithNestedGlyphs(item.text, plainTextOf(item.text), isNestedLink)
                : plainTextOf(item.text)
        }
        onChangeText={(displayText) =>
          (typedAtRef.current = Date.now()) &&
          onChangeText(
            item.id,
            type === 'code' ? displayText : applyDisplayEdit(item.text, displayWithLinkGlyphs(displayText))
          )
        }
        onFocus={() => onFocus(item.id)}
        onBlur={() => onBlur(item.id)}
        onPressIn={() => (touchedAtRef.current = Date.now())}
        {...softCursor(theme.scheme)}
        onSelectionChange={({ nativeEvent }) => {
          const { start, end } = nativeEvent.selection;
          lastSelectionRef.current = { start, end };
          // The caret never stands inside a note link. Put there by a FINGER on the text it is a tap on the link - its
          // menu, the caret after it; moved there by the keyboard (the space-bar drag, its arrows) it is carried ACROSS
          // to the side it was heading for (the user, 2026-10-25: a word before the link made the drag open the menu).
          // Checked a beat later, against the text as it then is, and never right after a letter is typed: Android
          // tells the caret moved before it tells the letter came.
          if (type !== 'code' && start === end && onNoteLinkMenu) {
            if (!noteLinkSpans(latestTextRef.current).some((sp) => start > sp.displayStart && start < sp.displayEnd)) outsideCaretRef.current = start;
            setTimeout(() => {
              if (Date.now() - typedAtRef.current < 400) return;
              const now = lastSelectionRef.current;
              if (!now || now.start !== start || now.end !== end) return;
              const span = noteLinkSpans(latestTextRef.current).find((sp) => start > sp.displayStart && start < sp.displayEnd);
              if (!span) return;
              const byFinger = Date.now() - touchedAtRef.current < 700;
              const from = outsideCaretRef.current;
              const to = !byFinger && from !== null && from >= span.displayEnd ? span.displayStart : span.displayEnd;
              setSelection(localInputRef.current, to, to);
              lastSelectionRef.current = { start: to, end: to };
              outsideCaretRef.current = to;
              onSelectionChange(item.id, to, to);
              if (byFinger) onNoteLinkMenu(item.id, span.documentId, span.label);
            }, 60);
          }
          onSelectionChange(item.id, start, end);
        }}
        onKeyPress={({ nativeEvent }) => {
          if (nativeEvent.key === 'Backspace' && item.text === '') {
            onBackspaceEmpty(item.id);
          }
        }}
        placeholder={type === 'checkbox' ? 'Завдання…' : type === 'heading' ? 'Заголовок…' : '…'}
        placeholderTextColor={rowPaperColor?.textMuted}
        style={[
          styles.blockInput,
          // A heading is the same field, in its own size - so the text
          // does not jump between typing it and reading it.
          headingStyle,
          type === 'code' && styles.codeText,
          item.checked && styles.checkedText,
          rowPaperColor && { color: rowPaperColor.text },
          // A sticker is yellow in every theme, so its ink stays dark
          // even where the paper's ink has gone white.
          item.isSticker && styles.stickerInk,
          type !== 'code' && scaledTextStyle,
          type !== 'code' && alignStyleOf(item),
          noteFace,
        ]}
        multiline
      >
        {liveChildren}
      </TextInput>
    ) : (
      // While not the active block, formatting markers (**bold** etc.) are
      // parsed into styled runs instead of showing as raw text - and a
      // plain Text has no touch handling of its own to fight the
      // ScrollView, so a swipe here scrolls the document. A tap makes this
      // the active block (a real TextInput, keyboard up).
      <Pressable
        key="locked"
        style={styles.blockInput}
        onPress={(e) => (isSelectMode ? onToggleSelected(item.id) : activateAtTouch(e))}
      >
        <Text
          ref={lockedTextRef}
          onLayout={(e) => {
            const w = Math.round(e.nativeEvent.layout.width);
            if (w !== lineWidth) setLineWidth(w);
          }}
          onTextLayout={(e) => {
            lockedLinesRef.current = e.nativeEvent.lines;
          }}
          style={[styles.blockDisplayText, headingStyle, item.checked && styles.checkedText, scaledTextStyle, alignStyleOf(item), noteFace]}
        >
          {item.text ? (
            <FormattedText
              segments={parseFormattedText(item.text)}
              defaultColor={item.isSticker ? STICKER_INK : (rowPaperColor?.text ?? theme.paper.ink)}
              search={searchHighlight}
              searchCurrent={searchCurrent}
              onTimecode={onTimecode && !isSelectMode ? (seconds) => onTimecode(item.id, seconds) : undefined}
              timecodeColor={theme.accent}
              onNoteLink={onNoteLink && !isSelectMode ? onNoteLink : undefined}
              onNoteLinkHold={onNoteLinkMenu && !isSelectMode ? (documentId, label) => onNoteLinkMenu(item.id, documentId, label) : undefined}
              linkGlyph={isNestedLink ? (ref) => (isNestedLink(ref) ? NESTED_GLYPH : LINK_GLYPH) : undefined}
              linkInk={theme.scheme === 'dark' ? LINK_BLUE_DARK : LINK_BLUE}
              linkTint={withAlpha(theme.scheme === 'dark' ? LINK_BLUE_DARK : LINK_BLUE, 0.14)}
              linkTextStyle={StyleSheet.flatten([styles.blockDisplayText, headingStyle, scaledTextStyle, noteFace])}
              linkMaxWidth={lineWidth || undefined}
            />
          ) : (
            <Text style={[styles.blockPlaceholder, rowPaperColor && { color: rowPaperColor.textMuted }]}>…</Text>
          )}
        </Text>
      </Pressable>
    );

    if (type === 'code') {
      content = (
        <View style={styles.codeBlock}>
          {isActive && !isSelectMode ? (
            textField
          ) : (
            // At rest a long line SCROLLS rather than wrapping - a wrapped
            // line of code is a line you have to reassemble by eye. Under
            // the caret it wraps, because an editable field that scrolls
            // sideways on Android fights the caret.
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Pressable onPress={(e) => (isSelectMode ? onToggleSelected(item.id) : activateAtTouch(e))}>
                <Text style={[styles.blockDisplayText, styles.codeText]}>
                  {item.text || <Text style={styles.blockPlaceholder}>код…</Text>}
                </Text>
              </Pressable>
            </ScrollView>
          )}
          {!!item.codeLanguage && <Text style={styles.codeLanguage}>{item.codeLanguage}</Text>}
        </View>
      );
    } else if (type === 'bulleted' || type === 'numbered') {
      content = (
        <View style={styles.prefixedRow}>
          <Text style={styles.bulletMark}>{type === 'numbered' ? `${listNumber ?? 1}.` : bulletFor(indentOf(item))}</Text>
          {textField}
        </View>
      );
    } else if (type === 'toggle') {
      // The chevron is the whole control: pressing it folds the page
      // under this line. It is drawn even where the row is inert (a
      // card's miniature), because a section that is folded on the page
      // has to look folded on the card - see visibleBlocks.
      content = (
        <View style={{ flex: 1 }}>
        <View style={styles.prefixedRow}>
          <Pressable
            hitSlop={8}
            style={styles.toggleMark}
            onPress={() => {
              // Two states: the chevron folds and unfolds.
              const mode = foldOf(item) === 'closed' ? 'open' : 'closed';
              onUpdateBlock(item.id, { foldMode: mode, collapsed: mode === 'closed' });
            }}
          >
            <Ionicons
              name={foldOf(item) === 'closed' ? 'chevron-forward' : 'chevron-down'}
              size={18}
              color={rowPaperColor?.textMuted ?? theme.paper.inkMuted}
            />
          </Pressable>
          {textField}
          {!isSelectMode && (
            // Grey and quiet: the choice of the block's view, behind three dots so the header carries no buttons.
            <Pressable
              hitSlop={8}
              // At a pointer the row's own drag handle floats at the right edge: the dots keep clear of it (they overlapped, 2026-10-21).
              style={[styles.toggleMark, { opacity: 0.55, paddingHorizontal: 4, marginRight: pointer ? 30 : 0 }]}
              accessibilityLabel="Вигляд блока"
              onPress={async () => {
                const now = foldOf(item);
                const choice = await ask({
                  title: 'Блок',
                  actions: [
                    { id: 'closed', label: now === 'closed' ? 'Згорнуто  ✓' : 'Згорнути', icon: 'chevron-forward' },
                    { id: 'open', label: now === 'open' ? 'Розгорнуто  ✓' : 'Розгорнути', icon: 'chevron-down' },
                    { id: 'color', label: 'Колір шапки…', icon: 'color-palette-outline' },
                  ],
                });
                if (choice === 'color') {
                  // The colour of the HEADER itself, like a table's header row: a pale wash from the note's muted set (or none).
                  const picked = await ask({
                    title: 'Колір шапки',
                    actions: [
                      { id: 'none', label: 'Без кольору', icon: 'ellipse-outline' as const },
                      { id: '0', label: 'Пісок', icon: 'ellipse' as const },
                      { id: '1', label: 'Шавлія', icon: 'ellipse' as const },
                      { id: '2', label: 'Глина', icon: 'ellipse' as const },
                    ],
                  });
                  if (picked === 'none') onUpdateBlock(item.id, { headColor: undefined });
                  else if (picked === '0' || picked === '1' || picked === '2') onUpdateBlock(item.id, { headColor: HIGHLIGHT_COLORS[Number(picked)] });
                  return;
                }
                if (choice !== 'closed' && choice !== 'open') return;
                onUpdateBlock(item.id, { foldMode: choice, collapsed: choice === 'closed' });
              }}
            >
              <Ionicons name="ellipsis-horizontal" size={16} color={rowPaperColor?.textMuted ?? theme.paper.inkMuted} />
            </Pressable>
          )}
        </View>
        {!!foldHint && foldOf(item) === 'closed' && (
          // What is inside, faintly, so a closed block does not look empty; a tap opens it (it is never edited closed).
          <Pressable
            onPress={() => onUpdateBlock(item.id, { foldMode: 'open', collapsed: false })}
            style={{ paddingLeft: 26, paddingBottom: 2 }}
            accessibilityLabel="Розгорнути"
          >
            <Text numberOfLines={1} style={{ color: rowPaperColor?.textMuted ?? theme.paper.inkFaint, fontSize: 13, lineHeight: 18 }}>
              {foldHint}
            </Text>
          </Pressable>
        )}
        </View>
      );
    } else if (type === 'checkbox') {
      const reminderLabel = formatReminderBadge(item);
      content = (
        <View style={styles.checkboxBlock}>
        <View style={styles.prefixedRow}>
          <Pressable hitSlop={8} onPress={() => onToggleChecked(item.id)} style={styles.taskCheck}>
            {/* Round and in the text's own ink - the soft style's task box
                (see SoftTaskCheck); on a note with its own paper colour,
                that paper's ink. */}
            <SoftTaskCheck
              checked={!!item.checked}
              ink={rowPaperColor?.text ?? theme.paper.ink}
              faint={rowPaperColor?.textMuted ?? theme.paper.inkFaint}
              paper={rowPaperColor?.background ?? theme.paper.fill}
            />
          </Pressable>
          {textField}
        </View>
        {/* With a pointer an EMPTY reminder line is not drawn under every task (the Mac's day sheet, 2026-10-16:
            a «Нагадування» line under each task) - it comes up at the row's right end while the pointer is over the
            task, taking no room (rows do not jump). A set one stays where it is. */}
        {!isSelectMode && (!pointer || !!reminderLabel || hover) && (
          <Pressable
            style={[styles.checkboxReminderRow, pointer && !reminderLabel && { position: 'absolute', right: 38, top: 4 }]}
            hitSlop={4}
            onPress={() => onOpenReminder(item.id)}
          >
            <Ionicons name="alarm-outline" size={11} color={reminderLabel ? theme.accent : theme.paper.inkFaint} />
            <Text style={[styles.checkboxReminderText, !reminderLabel && styles.checkboxReminderTextEmpty]}>
              {reminderLabel ?? 'Нагадування'}
            </Text>
          </Pressable>
        )}
        </View>
      );
    } else {
      content = textField;
    }
  }

  // A pointer's rows: the handle shows where the pointer is (and only
  // there), a pick is a light tint - no tick squares - see below.
  const showPointerHandle = pointer && !!handleGesture && hover;

  return (
    <View
      ref={hoverRef}
      style={[
        styles.blockRow,
        indented && !toggleRole && styles.blockRowIndented,
        // Block.indent: its steps in from the left, on top of a toggle's own (blockRowIndented's 16).
        indentOf(item) > 0 && { marginLeft: (indented && !toggleRole ? 16 : 0) + indentOf(item) * INDENT_STEP },
        // The toggle's FRAME, row by row: one rounded box from the title down to the last held row (2026-10-21).
        !!toggleRole && {
          borderColor: theme.paper.edge,
          borderTopWidth: toggleRole === 'solo' || toggleRole === 'head' ? 1 : 0,
          borderBottomWidth: toggleRole === 'solo' || toggleRole === 'foot' ? 1 : 0,
          borderTopLeftRadius: toggleRole === 'solo' || toggleRole === 'head' ? 14 : 0,
          borderTopRightRadius: toggleRole === 'solo' || toggleRole === 'head' ? 14 : 0,
          borderBottomLeftRadius: toggleRole === 'solo' || toggleRole === 'foot' ? 14 : 0,
          borderBottomRightRadius: toggleRole === 'solo' || toggleRole === 'foot' ? 14 : 0,
          paddingHorizontal: 12,
          // The header's own fill (chosen with «···»): only the title row, never the held blocks.
          ...((toggleRole === 'solo' || toggleRole === 'head') && item.headColor ? { backgroundColor: item.headColor } : null),
        },
        // The theme's own light-blue highlight, UNLESS the row is on a
        // custom paper colour: that highlight is opaque and fixed, and a
        // paper dark enough to want white text ('#FFFFFF' from
        // colorForDocument) went white-on-near-white under it - the
        // user's own catch, from a screenshot. A translucent wash instead,
        // darkening or lightening the SAME colour depending on which way
        // that colour's own text already reads, so whichever text was
        // chosen for it stays legible: never perfect for every hue, but
        // never backwards either.
        isSelected && (rowPaperColor ? { backgroundColor: rowPaperColor.text === '#FFFFFF' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.55)' } : pointer ? { backgroundColor: softTokens(theme.scheme).dark ? 'rgba(255,255,255,0.045)' : 'rgba(30,30,28,0.028)' } : styles.blockRowSelected),
        showBoundary && styles.blockRowBoundary,
        // A sticker keeps its yellow background even once placed here -
        // agreed explicitly: it should stay visibly "a sticker", not blend
        // in as an ordinary paragraph/image/sketch block.
        item.isSticker && styles.blockRowSticker,
        // Blends the row into the colored page instead of keeping its own
        // white card look - skipped while selected, whose own highlight is
        // a stronger, more important affordance than the paper color (see
        // above for what that highlight actually is on a custom paper).
        // showBoundary only draws a border (see blockRowBoundary), so it
        // stays visible over the transparent fill.
        rowPaperColor && !isSelected && { backgroundColor: 'transparent' },
      ]}
    >
      {item.boardView ? (
        // The line and its picture stand one under the other, the whole width (the row itself lays things side by side).
        <View style={{ flex: 1, minWidth: 0 }}>
          {content}
          <BoardPlaceSnap
            view={item.boardView}
            onRefresh={(next) => onUpdateBlock(item.id, { boardView: next })}
            onMissing={() => ask({ title: 'Дошка не відкрита', message: 'Відкрийте цю дошку поруч, щоб працювати з ділянкою.', actions: [], cancelLabel: 'Зрозуміло' })}
          />
        </View>
      ) : (
        content
      )}
      {/* On the right. Hidden where the sheet runs under the rail (the
          calendar's daily note) - but never while selecting: there it is
          the checkbox, and the only thing showing what is picked.

          Outside select mode it is drawn ONLY on the block being
          written in, and as an overlay rather than a column. The
          reasoning, from measuring rather than guessing: this Pressable
          is `disabled` outside select mode, so the handle was never the
          drag target - the whole row is (see SortableBlockRow), and the
          calendar's daily note has run without it for months. It was a
          SIGN, and a sign repeated down every row cost 32pt of every
          line for nothing. One sign, where the user is already looking,
          says the same thing.

          Absolute rather than in the row, because a handle that joined
          the layout on focus would reflow the text of the block being
          typed in - the one row where a jump is least acceptable. */}
      {/* At a pointer the handle is a hover's: on the right, as on the phone,
          and it does what the phone's hold does - dragging it moves the
          block (or the picked group), a click on it picks the block. */}
      {/* (Its data-no-marquee keeps it from starting a pick - see useBlockMarquee.) */}
      {showPointerHandle && (
        <GestureDetector gesture={handleGesture}>
          <View
            {...({ dataSet: { noMarquee: '1', fadeIn: '1' } } as object)}
            style={[styles.dragHandle, styles.dragHandleFloating, { top: '50%', marginTop: -16, opacity: 0.85, cursor: 'grab' } as never]}
          >
            <Ionicons name="reorder-two-outline" size={20} color={theme.ink.muted} />
          </View>
        </GestureDetector>
      )}
      {!pointer && (!hideHandle || isSelectMode) && (isSelectMode || isActive) && (
        <Pressable
          hitSlop={8}
          disabled={!isSelectMode}
          onPress={() => onToggleSelected(item.id)}
          style={[
            styles.dragHandle,
            !isSelectMode && styles.dragHandleFloating,
            // CHOOSING DOES NOT REFLOW THE TEXT (2026-10-05: "при натисканні
            // множинного вибору текст скаче ... на 1/3 екрана"): the checkbox
            // used to join the row as a column, every block lost its width,
            // long paragraphs wrapped into more lines and everything above
            // the eye moved. It floats now, in the block's top-right corner,
            // on the paper's own colour so a line's last word under it is
            // covered, not tangled with it.
            isSelectMode && [
              styles.dragHandleFloating,
              { opacity: 1, top: 2, right: -6, borderRadius: 10, backgroundColor: rowPaperColor?.background ?? theme.paper.fill },
            ],
          ]}
        >
          {isSelectMode ? (
            // The soft style's choosing mark (SoftCheck) - the same
            // rounded square the cards and the bar's «Виділити» wear, not
            // Material's ring: "тут теж кола при виділенні блоків".
            <SoftCheck
              checked={isSelected}
              size={24}
              accent={softTokens(theme.scheme).accent}
              outline={theme.paper.inkFaint}
              tickColor="#FFFFFF"
            />
          ) : (
            <Ionicons name="reorder-two-outline" size={20} color={theme.paper.inkFaint} />
          )}
        </Pressable>
      )}
    </View>
  );
}

const previewEmbedStyles = StyleSheet.create({
  plate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  title: { flex: 1, fontSize: 15, fontWeight: '600' },
});
