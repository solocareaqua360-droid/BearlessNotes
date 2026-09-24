import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  GestureResponderEvent,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
// Deliberately gesture-handler's ScrollView, not react-native's - see the
// same note in DocumentEditorScreen.tsx (this component moved out of that
// file on 2026-09-19).
import { ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { Block, Tag } from '../types';
import { useAttachmentSource } from '../hooks/useAttachmentSource';
import { useCachedAttachment } from '../hooks/useCachedAttachment';
import { useStyles, useTextScale, useTheme } from '../theme/ThemeProvider';
import { makeStyles } from './documentEditorStyles';
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
  STICKER_INK,
  type TextLayoutLine,
} from '../utils/documentBlocks';
import FormattedText from './FormattedText';
import TableBlockContent from './TableBlockContent';
import CustomRowBlockCard from './CustomRowBlockCard';
import DocumentRefBlockCard from './DocumentRefBlockCard';
import type { DocumentIndex } from '../hooks/useDocumentIndex';

const EMPTY_DOCUMENT_INDEX: DocumentIndex = new Map();
import CustomDatabaseViewBlockCard from './CustomDatabaseViewBlockCard';

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
  textVersion: number;
  // cursorIndex: DISPLAY-text position to place the cursor at (from a tap on
  // the locked text); omitted = end of the text.
  onActivate: (id: string, cursorIndex?: number) => void;
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
  softInputDisabled?: boolean;
  // null when "Колір паперу" is off, OR for a sticker block specifically -
  // a sticker keeps its own yellow/dark treatment regardless of the
  // document's paper color (see the isSticker comment in types.ts).
  paperColor: ReturnType<typeof colorForDocument> | null;
};

export default function BlockRow({
  item,
  hideHandle,
  isSelected,
  isSelectMode,
  isActive,
  showBoundary,
  listNumber,
  textVersion,
  onActivate,
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
  onOpenSketch,
  allTags,
  onOpenCustomRow,
  documentIndex,
  onOpenDocument,
  onOpenCustomView,
  inputRef,
  softInputDisabled,
  paperColor,
}: BlockRowProps) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  // Outside edit mode (or while selecting), the text field is completely
  // inert to touch (pointerEvents: 'none') rather than merely
  // non-editable - a TextInput that can still receive touches keeps
  // claiming them for cursor placement even when non-editable, which is
  // exactly what was blocking swipe-to-scroll over blocks. With no
  // TextInput to compete with, a swipe anywhere reaches the ScrollView
  // just like it already did over the icon column.
  const canEditText = isActive && !isSelectMode;

  // "Розмір тексту" - the reading scale, applied here rather than baked
  // into `styles.blockInput`/`heading1..3`: those come from a
  // theme-only `useStyles` factory, and a note's own body is exactly
  // the flexible, multi-line surface the user's own plan named first -
  // "починаємо з текстів для читання". A heading keeps its OWN base
  // size scaled, not the paragraph's, or the level would collapse into
  // paragraph text at anything but 1x.
  const textScale = useTextScale();
  const scaledTextStyle = (() => {
    const base =
      (item.type ?? 'paragraph') === 'heading'
        ? item.headingLevel === 1
          ? { fontSize: 26, lineHeight: 32 }
          : item.headingLevel === 3
            ? { fontSize: 18, lineHeight: 24 }
            : { fontSize: 21, lineHeight: 27 }
        : { fontSize: 16, lineHeight: 22 };
    return { fontSize: Math.round(base.fontSize * textScale), lineHeight: Math.round(base.lineHeight * textScale) };
  })();

  // Kept alongside the ref the screen collects, purely so the field can be
  // grown to its text - see autoGrowInput. On a phone this effect does
  // nothing at all; in a browser it is the difference between a block and
  // a two-line window with the rest of the block scrolled away inside it.
  const localInputRef = useRef<TextInput | null>(null);
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
  const fileCacheStatus = useCachedAttachment(type === 'file' ? item.fileUri : undefined, item.driveFileId);
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
    item.driveFileId
  );

  // Tap-to-cursor on the locked text (see displayIndexForTouch): the Text's
  // line layout, and the Text itself to turn the tap's page coordinates
  // into coordinates inside it.
  const lockedTextRef = useRef<Text>(null);
  const lockedLinesRef = useRef<TextLayoutLine[]>([]);
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
      onActivate(item.id, fromDom);
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
    onActivate(item.id, displayIndex);
  }

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
              {item.sketchElements.map((el, i) =>
                el.kind === 'text' ? (
                  <SvgText key={i} x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize}>
                    {el.text}
                  </SvgText>
                ) : (
                  <Path
                    key={i}
                    d={el.d}
                    stroke={el.color}
                    strokeWidth={el.width}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )
              )}
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
    // viewBox reuses the exact canvas size the elements were captured
    // against (see SketchEditor) so the drawing scales correctly here
    // regardless of how much smaller this preview box is.
    const elements = item.sketchElements ?? [];
    const vbWidth = item.sketchWidth || 1;
    const vbHeight = item.sketchHeight || 1;
    content = (
      <Pressable
        disabled={isSelectMode}
        onPress={() => onOpenSketch(item.id)}
        style={styles.blockImageWrap}
      >
        {elements.length > 0 ? (
          <Svg width="100%" height="100%" viewBox={`0 0 ${vbWidth} ${vbHeight}`}>
            {elements.map((el, i) =>
              el.kind === 'text' ? (
                <SvgText key={i} x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize}>
                  {el.text}
                </SvgText>
              ) : (
                <Path
                  key={i}
                  d={el.d}
                  stroke={el.color}
                  strokeWidth={el.width}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )
            )}
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
      />
    );
    // Locked, the table is display-only that a swipe scrolls through (its
    // cells are inert to touch); a tap wakes it for editing, same as text.
    content = canEditText ? (
      table
    ) : (
      <Pressable onPress={() => (isSelectMode ? onToggleSelected(item.id) : onActivate(item.id))}>
        <View pointerEvents="none">{table}</View>
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
  } else if (type === 'docRef') {
    // Another document, as a card. Live from the document index, so a
    // note renamed anywhere is renamed here - the same choice 'dbRow'
    // makes just below. Inert in select mode so a tap selects the block
    // instead of navigating away from it.
    content = (
      <View style={styles.dbRowBlock} pointerEvents={isSelectMode ? 'none' : 'auto'}>
        <DocumentRefBlockCard
          documentId={item.docRefId}
          fallbackTitle={item.docRefTitle}
          index={documentIndex ?? EMPTY_DOCUMENT_INDEX}
          onOpen={(id) => onOpenDocument?.(id)}
        />
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
        value={type === 'code' ? item.text : plainTextOf(item.text)}
        onChangeText={(displayText) =>
          onChangeText(item.id, type === 'code' ? displayText : applyDisplayEdit(item.text, displayText))
        }
        onFocus={() => onFocus(item.id)}
        onBlur={() => onBlur(item.id)}
        onSelectionChange={({ nativeEvent }) =>
          onSelectionChange(item.id, nativeEvent.selection.start, nativeEvent.selection.end)
        }
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
        ]}
        multiline
      />
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
          onTextLayout={(e) => {
            lockedLinesRef.current = e.nativeEvent.lines;
          }}
          style={[styles.blockDisplayText, headingStyle, item.checked && styles.checkedText, scaledTextStyle]}
        >
          {item.text ? (
            <FormattedText
              segments={parseFormattedText(item.text)}
              defaultColor={item.isSticker ? STICKER_INK : (rowPaperColor?.text ?? theme.paper.ink)}
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
          <Text style={styles.bulletMark}>{type === 'numbered' ? `${listNumber ?? 1}.` : '•'}</Text>
          {textField}
        </View>
      );
    } else if (type === 'toggle') {
      // The chevron is the whole control: pressing it folds the page
      // under this line. It is drawn even where the row is inert (a
      // card's miniature), because a section that is folded on the page
      // has to look folded on the card - see visibleBlocks.
      content = (
        <View style={styles.prefixedRow}>
          <Pressable hitSlop={8} onPress={() => onUpdateBlock(item.id, { collapsed: !item.collapsed })}>
            <Ionicons
              name={item.collapsed ? 'chevron-forward' : 'chevron-down'}
              size={18}
              color={rowPaperColor?.textMuted ?? theme.paper.inkMuted}
            />
          </Pressable>
          {textField}
        </View>
      );
    } else if (type === 'checkbox') {
      const reminderLabel = formatReminderBadge(item);
      content = (
        <View style={styles.checkboxBlock}>
        <View style={styles.prefixedRow}>
          <Pressable hitSlop={8} onPress={() => onToggleChecked(item.id)}>
            <Ionicons
              name={item.checked ? 'checkbox' : 'square-outline'}
              size={20}
              color={item.checked ? theme.accent : theme.paper.inkFaint}
            />
          </Pressable>
          {textField}
        </View>
        {!isSelectMode && (
          <Pressable style={styles.checkboxReminderRow} hitSlop={4} onPress={() => onOpenReminder(item.id)}>
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

  return (
    <View
      style={[
        styles.blockRow,
        isSelected && styles.blockRowSelected,
        showBoundary && styles.blockRowBoundary,
        // A sticker keeps its yellow background even once placed here -
        // agreed explicitly: it should stay visibly "a sticker", not blend
        // in as an ordinary paragraph/image/sketch block.
        item.isSticker && styles.blockRowSticker,
        // Blends the row into the colored page instead of keeping its own
        // white card look - skipped while selected, whose own light-blue
        // highlight is a stronger, more important affordance than the
        // paper color. showBoundary only draws a border (see
        // blockRowBoundary), so it stays visible over the transparent fill.
        rowPaperColor && !isSelected && { backgroundColor: 'transparent' },
      ]}
    >
      {content}
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
      {(!hideHandle || isSelectMode) && (isSelectMode || isActive) && (
        <Pressable
          hitSlop={8}
          disabled={!isSelectMode}
          onPress={() => onToggleSelected(item.id)}
          style={[styles.dragHandle, !isSelectMode && styles.dragHandleFloating]}
        >
          <Ionicons
            name={isSelectMode ? (isSelected ? 'checkmark-circle' : 'ellipse-outline') : 'reorder-two-outline'}
            size={isSelectMode ? 26 : 20}
            color={isSelected ? theme.accent : theme.paper.inkFaint}
          />
        </Pressable>
      )}
    </View>
  );
}
