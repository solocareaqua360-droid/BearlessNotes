import { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CoverGradientView, coverById, defaultCoverFor } from '../theme/covers';
import { useRecordColour, useTextScale, useTheme } from '../theme/ThemeProvider';
import { useDensity } from '../hooks/useDensity';
import CardPreview from './CardPreview';
import { Ionicons } from '@expo/vector-icons';
import type { Block, Tag } from '../types';
import AttachmentImage from './AttachmentImage';
import { PreviewChecklistItem, TextMatch, formatUpdatedAt } from '../utils/documentPreview';
import { FONT_REGULAR, FONT_BOLD } from '../utils/fonts';
import ProjectBadge from './ProjectBadge';
import DocumentPageMiniature from './DocumentPageMiniature';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// Fine grain laid over every card. Two things keep it reading as paper
// tooth and not as dirt: the specks are half lighter and half darker than
// the card under them, and the whole layer sits at a few percent. It goes
// UNDER the content and takes no touches.
//
// One 512px image per card, covering it - NOT resizeMode "repeat", which
// on Android here drew a single tile in the corner and left the rest of
// the card bare. 512 is bigger than any card, so "cover" only ever scales
// it down and the specks stay crisp.
const GRAIN = require('../../assets/paper-grain.png');

const THUMB_SIZE = 72;
// The same row for a cursor. Nothing about it changes but the air: the
// picture is smaller and the padding is thinner, so more of the list is
// on screen at once - which is the whole difference between a list you
// scroll and a list you read. See hooks/useDensity for why this is
// decided by what is POINTING at the row and not by how wide the window
// is.
const THUMB_SIZE_DENSE = 52;
const GRID_THUMB_HEIGHT = 96;
// Every grid card is exactly this tall, image or not - 20% past what a
// thumb + title + couple lines + date used to measure out to (~190).
// Fixed rather than a minimum: uniform card height is what keeps the grid
// gap-free without needing a masonry/waterfall layout at all.
const GRID_CARD_HEIGHT = 228;
// How far down the page a ROW's window opens: past the page's own empty
// band, which at a row's height would be most of what it showed.
const PAGE_HEADER_BAND = 24;
// The little sheet at the start of a row: a page's own shape, standing
// as tall as the row - which it can, now that a row's height is fixed.
const ROW_SHEET_W = 62;
const ROW_SHEET_H = 84;
const ROW_SHEET_W_DENSE = 46;
const ROW_SHEET_H_DENSE = 62;
// Taller where a cursor is looking at it. The user picked this off
// Craft's own grid: its cards are not richer than ours - they already
// carry the same checklist and photo strip - they are TALLER, and the
// height is what lets several lines of the note itself show instead of
// two. A phone keeps 228: there the scarce thing is how many cards fit
// on the screen at once.
const GRID_CARD_HEIGHT_POINTER = 320;

// The pixel budget below is what gridContent's own layout actually spends
// (see its style) - kept as named constants, and lineHeight set EXPLICITLY
// on titleCompact/dateCompact to match, rather than relying on each font's
// own default metric, specifically so this arithmetic is trustworthy
// instead of a guess dressed up as one.
const GRID_CONTENT_PADDING = 10; // gridContent's own padding, top and bottom
// The ONLY fixed gap in gridContent's own layout - titleCompact's own
// marginBottom, between the title and the preview text below it. There's
// deliberately no second one between the preview and the date: the date
// sits on marginTop: 'auto' (see dateCompactPinned), which consumes
// whatever space is left rather than adding a fixed amount on top of it -
// counting a fixed gap THERE as well would double-count the same space
// and undercount how many preview lines actually fit.
const GRID_CONTENT_GAP = 4;
const GRID_TITLE_MAX_LINES = 2;
const GRID_TITLE_LINE_HEIGHT = 20;
const GRID_DATE_LINE_HEIGHT = 14;
const GRID_PREVIEW_LINE_HEIGHT = 17; // matches previewCompact.lineHeight below

// gridContent (title + preview + date) always has to fit into whatever
// height is LEFT after the reserved space passed in - GRID_CARD_HEIGHT
// itself with no image, or GRID_CARD_HEIGHT minus the thumbnail (and its
// own bottom border) with one. The title is counted at its own worst case
// (2 full lines, not however many THIS title actually wraps to) so a
// card's line count stays consistent from one document to the next
// instead of shifting with how long a given title happens to be.
function previewLinesFitting(reservedHeight: number, cardHeight: number): number {
  const available =
    cardHeight -
    reservedHeight -
    GRID_CONTENT_PADDING * 2 -
    GRID_TITLE_LINE_HEIGHT * GRID_TITLE_MAX_LINES -
    GRID_CONTENT_GAP -
    GRID_DATE_LINE_HEIGHT;
  return Math.max(1, Math.floor(available / GRID_PREVIEW_LINE_HEIGHT));
}

// No image: gridContent fills the entire card, nothing reserved.
const EXPANDED_TEXT_LINES = previewLinesFitting(0, GRID_CARD_HEIGHT);
// With one: reserves the thumbnail's own height plus its 1px bottom
// border (see thumbGrid) - noticeably fewer lines fit, which is exactly
// why this needed computing separately rather than reusing one constant
// for both cases.
const THUMB_BORDER_WIDTH = 1;
const COMPACT_TEXT_LINES = previewLinesFitting(GRID_THUMB_HEIGHT + THUMB_BORDER_WIDTH, GRID_CARD_HEIGHT);
// The same two sums against the taller card. Computed, not guessed at:
// the extra height is worth nothing if the text still stops at the line
// count the short card could hold, and the card would simply gain empty
// space at the bottom - which is the opposite of what the height is for.
const EXPANDED_TEXT_LINES_POINTER = previewLinesFitting(0, GRID_CARD_HEIGHT_POINTER);
const COMPACT_TEXT_LINES_POINTER = previewLinesFitting(
  GRID_THUMB_HEIGHT + THUMB_BORDER_WIDTH,
  GRID_CARD_HEIGHT_POINTER
);

function HighlightedLine({
  match,
  style,
  highlightStyle,
  numberOfLines = 2,
}: {
  match: TextMatch;
  style: object;
  highlightStyle: object;
  numberOfLines?: number;
}) {
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {match.before}
      <Text style={highlightStyle}>{match.match}</Text>
      {match.after}
    </Text>
  );
}

// The "live content" body: real checklist rows (with strikethrough on a
// checked one) take priority over a photo strip, which takes priority over
// the plain text snippet - and each is capped to what extractPreview
// already trimmed it to.
//
// The checklist is no longer exclusive: it draws its rows and then
// spends whatever is left of the card's line budget on the text that is
// NOT in those rows (previewTail). A note with two tasks and six
// paragraphs used to show the two tasks and nothing else.
function PreviewBody({
  checklistItems,
  imageUris,
  imageDriveFileIds = [],
  previewText,
  previewTail,
  bodyMatch,
  textColor,
  mutedColor,
  compact,
  textLines = 2,
}: {
  checklistItems: PreviewChecklistItem[];
  imageUris: string[];
  imageDriveFileIds?: (string | undefined)[];
  previewText: string;
  // Optional: a caller that has no separate tail (SearchScreen) simply
  // shows the rows, as it always did.
  previewTail?: string;
  bodyMatch?: TextMatch | null;
  textColor: string;
  mutedColor: string;
  compact: boolean;
  // Only the plain-text branches below use this - a grid card with no
  // thumbnail passes a much larger value to fill the space the thumbnail
  // would have taken (see DocumentCard's own noImage handling). The
  // checklist/photo-strip branches keep their own fixed limits regardless
  // - extractPreview already caps what they're given to a handful of
  // items, not proportional to a document's real length the way plain
  // text is.
  textLines?: number;
}) {
  // Same rule as the title's own scaling above - only the LIST row's
  // plain-text preview, never the grid card's (fixed-height tile).
  const textScale = useTextScale();
  const scaledPreview = compact ? null : { fontSize: Math.round(15 * textScale), lineHeight: Math.round(21 * textScale) };
  if (checklistItems.length > 0) {
    // What is LEFT of the card after the rows. textLines is the card's
    // own line budget (see previewLinesFitting), and a checklist row is
    // one line of it - so whatever the rows do not spend, the text
    // below can. It used to spend nothing: a note with two tasks and
    // six paragraphs showed the two tasks and stopped, and the rest of
    // the card was empty. "Показує не весь вміст" - and on a tall card
    // there was a lot of it left to show.
    const linesLeft = textLines - checklistItems.length - 1;
    return (
      <View style={styles.checklist}>
        {checklistItems.map((item, index) => (
          <View key={index} style={styles.checklistRow}>
            <Ionicons
              name={item.checked ? 'checkbox' : 'square-outline'}
              size={compact ? 11 : 13}
              color={mutedColor}
            />
            <Text
              style={[
                compact ? styles.checklistTextCompact : styles.checklistText,
                { color: mutedColor },
                item.checked && styles.checklistTextDone,
              ]}
              numberOfLines={1}
            >
              {item.text}
            </Text>
          </View>
        ))}
        {!!previewTail && linesLeft > 0 && (
          <Text
            style={[
              compact ? styles.previewCompact : styles.preview,
              { color: mutedColor },
              scaledPreview,
              styles.checklistTail,
            ]}
            numberOfLines={linesLeft}
          >
            {previewTail}
          </Text>
        )}
      </View>
    );
  }
  if (imageUris.length > 1) {
    // Same idea as the checklist's tail above would be, but a photo
    // strip is a fixed block rather than a count of lines - left alone
    // until there is a reason to work its height out too.
    return (
      <View style={styles.photoStrip}>
        {imageUris.slice(0, compact ? 3 : 4).map((uri, index) => (
          <AttachmentImage key={index} uri={uri} driveFileId={imageDriveFileIds[index]} style={styles.photoStripItem} />
        ))}
      </View>
    );
  }
  if (bodyMatch) {
    return (
      <HighlightedLine
        match={bodyMatch}
        style={[compact ? styles.previewCompact : styles.preview, { color: mutedColor }, scaledPreview]}
        highlightStyle={styles.highlight}
        numberOfLines={textLines}
      />
    );
  }
  if (!previewText) return null;
  return (
    <Text
      style={[compact ? styles.previewCompact : styles.preview, { color: mutedColor }, scaledPreview]}
      numberOfLines={textLines}
    >
      {previewText}
    </Text>
  );
}

type Props = {
  id: string;
  title: string;
  updatedAt: number;
  imageUri: string | null;
  // Set = the user's chosen gradient, which beats a picture found in the
  // body; unset = the note's own default gradient, shown when there is no
  // picture. See theme/covers.
  coverGradient?: string;
  // The Drive copies behind imageUri and imageUris, for where the paths
  // cannot be read - see AttachmentImage. Parallel to imageUris on
  // purpose: the strip is drawn by index and that is the cheapest shape
  // that keeps it so.
  imageDriveFileId?: string;
  imageDriveFileIds?: (string | undefined)[];
  previewText: string;
  // previewText without the checklist's rows - what a card fills the
  // space under those rows with. See extractPreview.
  previewTail?: string;
  // The note's own blocks. Given them, a GRID card stops summarising
  // and draws a miniature of the page instead - text, checkboxes,
  // headings, file chips, in the order they are actually in. See
  // CardPreview. Optional: a list row is one line beside a thumbnail
  // and has no room to be a page, and SearchScreen has only the
  // matched text anyway.
  blocks?: Block[];
  // "Live content" preview - a checklist-heavy document shows its actual
  // rows (checked ones struck through), a photo-heavy one shows a strip of
  // thumbnails, instead of just previewText's flattened text. Optional so
  // SearchScreen (which never sets these) still gets the old plain preview.
  imageUris?: string[];
  checklistItems?: PreviewChecklistItem[];
  // When set (a search match), the title or preview line renders with the
  // matched substring highlighted instead of the plain text - see
  // SearchScreen. DocumentsScreen's own list never sets these.
  titleMatch?: TextMatch | null;
  bodyMatch?: TextMatch | null;
  // The search query itself, for a card that draws its page: every match
  // is marked on the page, and the page slides down to the first one -
  // see DocumentPageMiniature.
  search?: string;
  onPress: () => void;
  // Held down: the card's own menu (move, rename, bin) - see the documents
  // screen. Optional, because the other screens that draw this card have
  // no such menu.
  onLongPress?: () => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  // 'list' (default) is the original wide row. 'grid' is a compact square
  // card for DocumentsScreen's 2-column view - thumbnail on top instead of
  // beside the text, smaller type, select-checkbox as a corner overlay
  // instead of a trailing icon (a grid card has no natural trailing edge
  // the way a full-width row does).
  layout?: 'list' | 'grid';
  // The card's width in a grid, in pixels, worked out by the list from
  // its own width and column count - so a row of cards ends where a row
  // of folders does. Absent, the card keeps the 48% it always had for a
  // phone's two columns.
  gridWidth?: number;
  // A list row carries its own side margin, because the documents list it
  // was built for has none of its own. Anywhere the container already
  // provides that margin (a group's section under another database's
  // list), `flush` drops it so the card lines up with everything beside
  // it instead of sitting 20pt further in.
  flush?: boolean;
  // The card's own node, handed to whatever needs to measure it - the
  // carry gesture asks what is under the finger (see useCardCarry), and a
  // card is the answer. On the card's OWN root, never a wrapper: these
  // cards are flex items in a grid, and a wrapper takes that role for
  // itself (see ItemCards' cardRef, where the same lesson is written).
  cardRef?: (node: View | null) => void;
  // THE TILE AS THE PAGE ITSELF - see DocumentPageMiniature for why.
  // Given, a tile stops being its own composition (cover, title, extract)
  // and becomes the top of the document's real page, scaled. Absent,
  // every layout draws exactly what it always drew.
  page?: {
    tagIds: string[];
    tags: Tag[];
    coverImageUri?: string;
    coverDriveFileId?: string;
    paperColorEnabled?: boolean;
  };
  // What every tile in this grid stands at - see gridHeight.
  pageHeight?: number;
  // Being carried right now - the card stays where it is and fades, the
  // ghost at the finger is the thing in hand.
  dimmed?: boolean;
  // Shown at the date's own level, in the card's right corner - always,
  // even when unset (a gray "Без проекту" chip, see ProjectBadge).
  // Optional because SearchScreen, the card's other user, never sets it.
  project?: { name: string; color: string } | null;
  onProjectPress?: () => void;
  // A grid card that takes the WHOLE row instead of one cell, with the
  // cover standing on its left rather than lying across its top - the
  // user's own shape: "картку розміром як дві, обкладинка ліворуч". The
  // grid puts it on a row of its own (see DocumentsScreen's spacers).
  wide?: boolean;
};

// The card shared by Documents and Search: a thumbnail (the document's
// first image block, or a plain placeholder box with a document icon when
// it has none), title, a live content preview, and the last-edited
// timestamp.
//
// The card's fill color comes from `recordColour(id)` - a fixed palette
// picked deterministically from the document's own id (see that file for
// why it isn't a random pick or a stored field), with the text/border/
// delete-icon colors all derived to stay readable against whichever fill a
// given document landed on.
// THE PAGE'S OWN PAPER, fading up into nothing - not a white slab.
// Hard-coded white, it was a bright band across a dark page in the black
// theme, and a wall of them scrolling past read as a zebra. And whatever
// the colour, an edge is what the eye catches: this has none, it simply
// stops being there.
//
// MEASURED, never "100%". react-native-svg's own percentage width and
// height on the root <Svg> are not reliable here - this file's own list
// screen already says so, about a gradient that stayed sized to a folded
// phone's width after it was unfolded - and drawn that way this one did
// not paint at all: "плашка на картці ніби прозора".
function PageChromeFade({ id, color }: { id: string; color: string }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {box.w > 0 && box.h > 0 && (
        <Svg width={box.w} height={box.h} pointerEvents="none">
          <Defs>
            {/* Unique per card: a gradient id is a name in the whole
                document, and a wall of cards sharing one is a wall of
                cards sharing whichever definition was drawn last. */}
            <LinearGradient id={`chrome-${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0} />
              <Stop offset="0.55" stopColor={color} stopOpacity={0.86} />
              <Stop offset="1" stopColor={color} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={box.w} height={box.h} fill={`url(#chrome-${id})`} />
        </Svg>
      )}
    </View>
  );
}

// A CARD'S WHOLE BODY, when the card is the page: the picture, and the
// card's own line over it. Measured rather than told its width - a row
// is a flex child and a tile can be half of whatever is left, so only
// the layout knows.
function PageBody({
  id,
  title,
  blocks,
  page,
  project,
  updatedAt,
  onProjectPress,
  height,
  offsetY,
  paper,
  paperColor,
  ink,
  search,
}: {
  search?: string;
  id: string;
  title: string;
  blocks: Block[];
  page: {
    tagIds: string[];
    tags: Tag[];
    coverImageUri?: string;
    coverDriveFileId?: string;
    paperColorEnabled?: boolean;
  };
  project?: { name: string; color: string } | null;
  updatedAt: number;
  onProjectPress?: () => void;
  height: number;
  offsetY?: number;
  // What the page is drawn ON, and the ink for the card's own line over
  // it. A note can set a paper colour for itself, and then both of these
  // are that colour's, not the theme's.
  paper: string;
  paperColor: { background: string; text: string; textMuted: string } | null;
  ink: string;
}) {
  const [width, setWidth] = useState(0);
  return (
    <View
      // `width: '100%'` and not flex: the wide card's own container is a
      // ROW, where a child that asks for nothing gets nothing - which is
      // exactly what it drew: an empty card, chrome and all.
      style={{ height, width: '100%', overflow: 'hidden' }}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        setWidth((prev) => (prev === w ? prev : w));
      }}
    >
      {width > 0 && (
        <DocumentPageMiniature
          title={title}
          blocks={blocks}
          tagIds={page.tagIds}
          tags={page.tags}
          project={project ?? null}
          coverImageUri={page.coverImageUri}
          coverDriveFileId={page.coverDriveFileId}
          paperColor={paperColor}
          width={width}
          height={height}
          offsetY={offsetY}
          highlight={search}
        />
      )}
      {/* What the CARD knows and the page does not - when it was last
          touched, and which project it belongs to. Over the picture
          rather than inside it, so the picture stays the page. */}
      <View style={styles.pageChrome} pointerEvents="box-none">
        <PageChromeFade id={id} color={paper} />
        <Text style={[styles.dateCompact, { color: ink }]}>{formatUpdatedAt(updatedAt)}</Text>
        {onProjectPress && <ProjectBadge project={project} onPress={onProjectPress} glass />}
      </View>
    </View>
  );
}

export default function DocumentCard({
  id,
  title,
  updatedAt,
  imageUri,
  coverGradient,
  imageDriveFileId,
  previewText,
  previewTail,
  blocks,
  imageUris = [],
  imageDriveFileIds = [],
  checklistItems = [],
  titleMatch,
  bodyMatch,
  search,
  onPress,
  onLongPress,
  isSelectMode,
  isSelected,
  onToggleSelect,
  layout = 'list',
  gridWidth,
  flush,
  cardRef,
  page,
  pageHeight,
  dimmed,
  project,
  onProjectPress,
  wide,
}: Props) {
  const recordColour = useRecordColour();
  const { background, text, textMuted } = recordColour(id);
  const isGrid = layout === 'grid';
  // Packed for a cursor, spaced for a thumb - see hooks/useDensity.
  // Only the list row answers to this so far; a grid tile is sized by
  // its picture, which is the thing being looked at rather than air.
  const pointer = useDensity() === 'pointer';
  const dense = pointer && !isGrid;
  // The tile's own height, and with it how much of the note shows.
  // A TILE IS A SHEET, so its shape is a sheet's - taller than it is
  // wide, by the proportion below, worked out from the tile's own width
  // rather than fixed. `pageHeight` is passed in for the one card that
  // cannot work it out for itself: a WIDE card is twice the width and
  // must still stand exactly as tall as an ordinary tile beside it, or a
  // row of one and a row of two stop reading as one grid.
  const gridHeight = pageHeight ?? (pointer ? GRID_CARD_HEIGHT_POINTER : GRID_CARD_HEIGHT);
  const theme = useTheme();
  // The band above a page's title is just air now - a page is a sheet
  // that starts below the status bar, so it no longer has one to clear
  // (see DocumentEditorScreen's `sheetPage`). A card can open its window
  // at the page's own top again.
  const pageTopSkip = 0;
  // A note that carries a paper colour of its own draws its page on it -
  // and so does every card that IS that page. `recordColour` is the same
  // palette the editor asks, keyed the same way, so the two cannot
  // disagree.
  const pagePaper = page?.paperColorEnabled ? recordColour(id) : null;
  const pageFill = pagePaper?.background ?? theme.paper.fill;
  const pageInk = pagePaper?.textMuted ?? theme.paper.inkMuted;
  const expandedLines = pointer ? EXPANDED_TEXT_LINES_POINTER : EXPANDED_TEXT_LINES;
  const compactLines = pointer ? COMPACT_TEXT_LINES_POINTER : COMPACT_TEXT_LINES;
  // "Розмір тексту" - only the LIST row's own size, never the grid
  // card's: `titleCompact`'s line height is measured against elsewhere
  // (EXPANDED_TEXT_LINES, a fixed-height tile), and scaling it would be
  // exactly the "iconography stops fitting" risk the user named. The
  // list row has no such fixed box to overflow.
  const textScale = useTextScale();
  const scaledTitle = isGrid ? null : { fontSize: Math.round(18 * textScale) };
  // A list row keeps its own square placeholder regardless (a small
  // thumbnail beside text reads as "no photo yet", not as reserved cover
  // space) - only the grid card's top-of-card image slot goes away
  // entirely when there's nothing to show there, reclaiming that height
  // for more preview text instead.
  // A note always has a cover now: a chosen gradient beats a picture from
  // the body, a picture beats the default gradient, and the default is
  // always there - so the grid card never reclaims the slot any more.
  const chosen = coverById(coverGradient);
  const gradient = chosen ?? (imageUri ? undefined : defaultCoverFor(id));
  const noImage = false;

  const titleNode = titleMatch ? (
    <HighlightedLine
      match={titleMatch}
      style={[isGrid ? styles.titleCompact : styles.title, { color: text }, scaledTitle]}
      highlightStyle={styles.highlight}
    />
  ) : (
    <Text
      style={[isGrid ? styles.titleCompact : styles.title, { color: text }, scaledTitle]}
      // ONE LINE in a row that carries a sheet, and an ellipsis where it
      // would have wrapped. A second line made every card a different
      // height, and equal heights are what let the sheet be a rectangle
      // of the row's own shape rather than a square floating in it - the
      // user's own reasoning for the trade.
      numberOfLines={page && !isGrid && !wide ? 1 : 2}
    >
      {title || 'Без назви'}
    </Text>
  );

  // A wide card's cover STANDS in a column of its own, so it fills that
  // column's whole height - the grid's own thumb is a fixed 96 tall
  // (right for a strip lying across the top, and a cut-off picture with
  // dead space under it here).
  const thumbStyle = wide
    ? styles.thumbWide
    : isGrid
      ? styles.thumbGrid
      : [styles.thumb, dense && styles.thumbDense];
  const thumbNode = gradient ? (
    <CoverGradientView gradient={gradient} style={thumbStyle} />
  ) : imageUri ? (
    <AttachmentImage uri={imageUri} driveFileId={imageDriveFileId} style={thumbStyle} />
  ) : (
    <View style={[thumbStyle, styles.thumbPlaceholder]}>
      <Ionicons name="document-text-outline" size={22} color="#D1D5DB" />
    </View>
  );

  // A page, where there is a page's worth of room. A list row is a line
  // of text beside a thumbnail - there is nothing to miniaturise into
  // it - so the summary below still serves it.
  const previewBody = isGrid && blocks && blocks.length > 0 ? (
    <CardPreview blocks={blocks} color={text} mutedColor={textMuted} />
  ) : (
    <PreviewBody
      checklistItems={checklistItems}
      imageUris={imageUris}
      imageDriveFileIds={imageDriveFileIds}
      previewText={previewText}
      previewTail={previewTail}
      bodyMatch={bodyMatch}
      textColor={text}
      mutedColor={textMuted}
      compact={isGrid}
      // A wide card's cover is BESIDE the text, not above it, so the
      // text column has the card's full height to itself - the same
      // budget a tile with no picture at all gets.
      textLines={wide ? expandedLines : isGrid ? (noImage ? expandedLines : compactLines) : 2}
    />
  );

  const selectIcon = isSelectMode && (
    <Ionicons
      name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
      size={22}
      color={isSelected ? text : textMuted}
    />
  );

  if (isGrid && wide) {
    return (
      <View
        ref={cardRef}
        collapsable={false}
        style={[
          styles.gridCard,
          styles.wideCard,
          { height: gridHeight },
          // A card spanning cells of a TILE grid has to be told the row's
          // width (its own cell is one column); one in the wide column
          // takes the row it is given, which is what keeps it from
          // standing out past the folders above it.
          gridWidth !== undefined ? { width: gridWidth } : null,
          { backgroundColor: background },
          dimmed && styles.dimmed,
        ]}
      >
        <Image source={GRAIN} resizeMode="cover" resizeMethod="resize" style={styles.grain} />
        <Pressable style={styles.wideTap} onPress={isSelectMode ? onToggleSelect : onPress} onLongPress={onLongPress}>
          {page ? (
            /* The same picture, in a wider window: twice a tile's width
               means the page is drawn nearly at its own size, so this is
               the opening of the document to read rather than the shape
               of it to recognise. */
            <PageBody
              id={id}
              title={title}
              blocks={blocks ?? []}
              page={page}
              project={project}
              updatedAt={updatedAt}
              onProjectPress={onProjectPress}
              height={gridHeight}
              offsetY={pageTopSkip}
              paper={pageFill}
              paperColor={pagePaper}
              ink={pageInk}
              search={search}
            />
          ) : (
            <>
          {/* A tall picture standing on the left edge, floor to ceiling -
              the user's own preference once both were on screen: "от
              така вертикальне зображення". */}
          <View style={styles.wideThumb}>{thumbNode}</View>
          <View style={styles.wideContent}>
            {titleNode}
            {previewBody}
            <View style={[styles.dateCompactPinned, styles.dateRow]}>
              <Text style={[styles.dateCompact, { color: textMuted }]}>{formatUpdatedAt(updatedAt)}</Text>
              {onProjectPress && <ProjectBadge project={project} onPress={onProjectPress} glass />}
            </View>
          </View>
            </>
          )}
        </Pressable>
        {isSelectMode && (
          <View style={styles.gridSelectBox} pointerEvents="none">
            <Ionicons
              name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={isSelected ? text : '#fff'}
            />
          </View>
        )}
      </View>
    );
  }

  if (isGrid) {
    return (
      <View
        ref={cardRef}
        collapsable={false}
        style={[
          styles.gridCard,
          { height: gridHeight },
          gridWidth !== undefined ? { width: gridWidth } : styles.gridCardHalf,
          { backgroundColor: background },
          dimmed && styles.dimmed,
        ]}
      >
        <Image source={GRAIN} resizeMode="cover" resizeMethod="resize" style={styles.grain} />
        <Pressable style={styles.gridTap} onPress={isSelectMode ? onToggleSelect : onPress} onLongPress={onLongPress}>
          {page ? (
            <PageBody
              id={id}
              title={title}
              blocks={blocks ?? []}
              page={page}
              project={project}
              updatedAt={updatedAt}
              onProjectPress={onProjectPress}
              height={gridHeight}
              offsetY={pageTopSkip}
              paper={pageFill}
              paperColor={pagePaper}
              ink={pageInk}
              search={search}
            />
          ) : (
            <>
          {/* Bleeds flush to the card's own top/left/right edges - no
              padding, no border-radius of its own. The card's overflow:
              'hidden' + borderRadius clips its top corners to match; a
              bottom border is the only boundary it gets (see thumbGrid),
              rather than a frame on all four sides. Absent entirely (not
              just empty space) when there's no image at all - see
              DocumentCard's own noImage handling. */}
          {thumbNode}
          <View style={styles.gridContent}>
            {titleNode}
            {previewBody}
            {/* marginTop: 'auto' on a flex-column child pins it to the
                bottom regardless of how much (or little) is above it -
                title/preview group at the top, the date always anchors
                this content block's own bottom edge (which, with no
                thumbnail above it, is the whole card's bottom edge). */}
            <View style={[styles.dateCompactPinned, styles.dateRow]}>
              <Text style={[styles.dateCompact, { color: textMuted }]}>{formatUpdatedAt(updatedAt)}</Text>
              {onProjectPress && <ProjectBadge project={project} onPress={onProjectPress} glass />}
            </View>
          </View>
            </>
          )}
        </Pressable>
        {isSelectMode && (
          // Purely decorative overlay - pointerEvents="none" so it doesn't
          // steal the tap from gridTap underneath (an absolutely-positioned
          // sibling View sits in front for hit-testing even with no onPress
          // of its own, which made tapping right on the icon miss almost
          // every time).
          <View style={styles.gridSelectBox} pointerEvents="none">
            <Ionicons
              name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={isSelected ? text : '#fff'}
            />
          </View>
        )}
      </View>
    );
  }

  return (
    <View
      ref={cardRef}
      collapsable={false}
      style={[
        styles.row,
        dense && styles.rowDense,
        flush && styles.rowFlush,
        // A height of its own, now that the title cannot wrap: every row
        // the same, which is the whole point of the one line above.
        page && (dense ? styles.rowPagedDense : styles.rowPaged),
        { backgroundColor: background },
        dimmed && styles.dimmed,
      ]}
    >
      <Image source={GRAIN} resizeMode="cover" resizeMethod="resize" style={styles.grain} />
      <Pressable style={styles.tap} onPress={isSelectMode ? onToggleSelect : onPress} onLongPress={onLongPress}>
        {/* A ROW IS A LINE OF TEXT BESIDE A THUMBNAIL, and it stays one:
            a strip of the page across the whole width was the title and
            nothing else, at a size nobody asked for - "виглядає погано і
            це не твоя вина, це вина форми". What the page gives a row is
            its THUMBNAIL: the little sheet Craft puts at the start of
            every line, which is the document itself rather than a
            picture pulled out of it or a grey glyph standing in for one.
            The title and the line under it are the row's own, as they
            always were. */}
        {page ? (
          <View style={[styles.rowSheet, dense && styles.rowSheetDense]}>
            <DocumentPageMiniature
              title={title}
              blocks={blocks ?? []}
              tagIds={page.tagIds}
              tags={page.tags}
              project={null}
              coverImageUri={page.coverImageUri}
              coverDriveFileId={page.coverDriveFileId}
              width={dense ? ROW_SHEET_W_DENSE : ROW_SHEET_W}
              height={dense ? ROW_SHEET_H_DENSE : ROW_SHEET_H}
              offsetY={PAGE_HEADER_BAND}
              highlight={search}
            />
          </View>
        ) : (
          thumbNode
        )}
        <View style={styles.body}>
          {titleNode}
          {previewBody}
          <View style={styles.dateRow}>
            <Text style={[styles.date, { color: textMuted }]}>{formatUpdatedAt(updatedAt)}</Text>
            {onProjectPress && <ProjectBadge project={project} onPress={onProjectPress} glass />}
          </View>
        </View>
        {isSelectMode && <View style={styles.selectBox}>{selectIcon}</View>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // A card whose document is in hand right now.
  dimmed: {
    opacity: 0.4,
  },
  grain: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    // The card's own overflow: 'hidden' clips this to its corners.
    //
    // This multiplies with the image's own alpha - about one pixel in
    // fourteen carries 15-50 of 255 - so what lands on the card is under
    // a percent. Getting that product wrong by one factor is how the
    // first attempt came out at a third of a percent and looked like
    // nothing at all, and the second like television static.
    opacity: 0.85,
  },
  rowFlush: {
    marginHorizontal: 0,
  },
  // Only the air, and only downwards. The border, the radius and the
  // colours are untouched, so the row still reads as the same card -
  // there is just less of it that is nothing.
  rowDense: {
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    borderRadius: 16,
    // A thin, muted border so a light-colored card doesn't visually merge
    // into the page's gradient background behind it - reads as an edge on
    // both the warm and the cool end of that gradient.
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
    // Clips the grain to the card's rounded corners. The elevation shadow
    // is drawn by the system outside these bounds, so it survives.
    overflow: 'hidden',
    // Drop shadow onto the gradient behind the card - previously a flat
    // row with no shadow at all.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  tap: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  selectBox: {
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
  },
  thumbDense: {
    width: THUMB_SIZE_DENSE,
    height: THUMB_SIZE_DENSE,
  },
  thumbPlaceholder: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 3,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
  },
  preview: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: FONT_REGULAR,
  },
  highlight: {
    backgroundColor: '#FEF08A',
    color: '#111827',
  },
  date: {
    fontSize: 13,
    marginTop: 2,
    fontFamily: FONT_REGULAR,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  checklist: {
    gap: 3,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  checklistText: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
  },
  checklistTextCompact: {
    flex: 1,
    fontSize: 12,
    fontFamily: FONT_REGULAR,
  },
  checklistTextDone: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  // A line of air between the rows and the text that follows them, so
  // the two read as two things rather than one run-on list.
  checklistTail: {
    marginTop: 4,
  },
  photoStrip: {
    flexDirection: 'row',
    gap: 4,
  },
  photoStripItem: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
  },
  // --- grid layout ---
  gridCard: {
    // Fixed proportion, not flex:1 - a `flex` card stretches to fill
    // whatever's left in its row, which is fine with a full row but means
    // a row with only ONE card (e.g. a filter down to a single result)
    // stretches it across the full width instead of keeping the usual
    // tile size. The proportion itself is set at the call site, from the
    // number of columns.
    height: GRID_CARD_HEIGHT,
    marginBottom: 10,
    // No padding here - the thumbnail (when there is one) needs to reach
    // all four... well, three of this card's own edges. Text content gets
    // its own padding one level in (see gridContent).
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
    // A fixed height is a hard ceiling, not just a look - clips rather
    // than visually overflowing a card whose expanded text (no thumbnail)
    // would otherwise run past it.
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  gridCardHalf: {
    width: '48%',
  },
  // flex: 1 fills the card's own fixed height. No padding/gap of its own -
  // the thumbnail (a direct child, when there is one) needs zero space
  // around it; gridContent below carries the padding everything else gets.
  gridTap: {
    flex: 1,
  },
  thumbGrid: {
    width: '100%',
    height: GRID_THUMB_HEIGHT,
    backgroundColor: '#F3F4F6',
    // The only boundary this gets - no border-radius (the card's own
    // overflow: 'hidden' + borderRadius already clips the top corners to
    // match) and no margin (it sits flush against gridContent below).
    // Width matches THUMB_BORDER_WIDTH above, which COMPACT_TEXT_LINES is
    // computed against.
    borderBottomWidth: THUMB_BORDER_WIDTH,
    borderBottomColor: 'rgba(0,0,0,0.12)',
  },
  // Everything that isn't the thumbnail - flex: 1 so it fills whatever
  // height the thumbnail (if present) didn't take, which is what makes
  // the date's marginTop: 'auto' below mean anything in either case.
  // No gap here on purpose - see GRID_CONTENT_GAP's own comment on why the
  // one fixed gap this layout has lives on titleCompact's own marginBottom
  // instead, with nothing fixed between the preview and the date.
  gridContent: {
    flex: 1,
    padding: 10,
  },
  // The double-width card: the same height as an ordinary tile, so a row
  // of one and a row of two still read as one grid.
  // Takes the row it is given rather than a width worked out for it -
  // a measured number that disagreed with the list's own padding by
  // even a little is a card standing out past the folders above it.
  wideCard: {
    height: GRID_CARD_HEIGHT,
    width: '100%',
  },
  wideTap: {
    flex: 1,
    flexDirection: 'row',
  },
  // A column of its own, floor to ceiling.
  wideThumb: {
    width: '34%',
    overflow: 'hidden',
    borderRightWidth: THUMB_BORDER_WIDTH,
    borderRightColor: 'rgba(0,0,0,0.12)',
  },
  wideContent: {
    flex: 1,
    minWidth: 0,
    padding: GRID_CONTENT_PADDING,
  },
  // Fills the little square, whatever the picture's own shape.
  thumbWide: {
    flex: 1,
    width: '100%',
    backgroundColor: '#F3F4F6',
  },
  titleCompact: {
    fontSize: 15,
    // Explicit, matching GRID_TITLE_LINE_HEIGHT above - EXPANDED_TEXT_LINES
    // is computed against this exact number, not whatever this font's own
    // default metric happens to be.
    lineHeight: 20,
    // Matches GRID_CONTENT_GAP - the one fixed gap in this layout (see its
    // own comment).
    marginBottom: 4,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
  },
  previewCompact: {
    fontSize: 13,
    lineHeight: 17,
    fontFamily: FONT_REGULAR,
  },
  dateCompact: {
    fontSize: 11,
    // Explicit, matching GRID_DATE_LINE_HEIGHT above - see titleCompact's
    // identical reasoning. marginTop here is always overridden by
    // dateCompactPinned's own 'auto' (this style is only ever used in the
    // grid layout, combined with that one) - kept rather than removed
    // since it's harmless and this is what a non-pinned instance would
    // fall back to.
    lineHeight: 14,
    marginTop: 2,
    fontFamily: FONT_REGULAR,
  },
  dateCompactPinned: {
    marginTop: 'auto',
  },
  // The card's own line along the bottom of the page picture, on a
  // wash so a page that ends in text does not swallow it.
  pageChrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    paddingHorizontal: 10,
    // Room for the fade to happen in - a gradient in eight points is a
    // line with soft edges, not a fade.
    paddingTop: 34,
    paddingBottom: 8,
  },
  // The little sheet at the start of a row: a real page, cut to a
  // square, with an edge so it reads as paper rather than as a hole.
  rowSheet: {
    width: ROW_SHEET_W,
    height: ROW_SHEET_H,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(140,140,140,0.45)',
  },
  rowSheetDense: {
    width: ROW_SHEET_W_DENSE,
    height: ROW_SHEET_H_DENSE,
  },
  // Exactly the sheet plus the row's own padding, so the sheet decides
  // the row's height rather than the text does.
  rowPaged: {
    height: ROW_SHEET_H + 24,
    alignItems: 'center',
  },
  rowPagedDense: {
    height: ROW_SHEET_H_DENSE + 16,
    alignItems: 'center',
  },
  gridSelectBox: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
