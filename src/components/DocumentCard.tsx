import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PreviewChecklistItem, TextMatch, formatUpdatedAt } from '../utils/documentPreview';
import { colorForDocument } from '../utils/documentColor';
import { FONT_REGULAR, FONT_BOLD } from '../utils/fonts';

// A tile of fine grain laid over every card, repeated rather than
// stretched. Two things keep it reading as paper tooth and not as dirt:
// the specks are half lighter and half darker than the card under them,
// and the whole layer sits at a few percent. It goes UNDER the content
// and takes no touches.
const GRAIN = require('../../assets/paper-grain.png');

const THUMB_SIZE = 72;
const GRID_THUMB_HEIGHT = 96;
// Every grid card is exactly this tall, image or not - 20% past what a
// thumb + title + couple lines + date used to measure out to (~190).
// Fixed rather than a minimum: uniform card height is what keeps the grid
// gap-free without needing a masonry/waterfall layout at all.
const GRID_CARD_HEIGHT = 228;

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
const GRID_TITLE_LINE_HEIGHT = 17;
const GRID_DATE_LINE_HEIGHT = 13;
const GRID_PREVIEW_LINE_HEIGHT = 15; // matches previewCompact.lineHeight below

// gridContent (title + preview + date) always has to fit into whatever
// height is LEFT after the reserved space passed in - GRID_CARD_HEIGHT
// itself with no image, or GRID_CARD_HEIGHT minus the thumbnail (and its
// own bottom border) with one. The title is counted at its own worst case
// (2 full lines, not however many THIS title actually wraps to) so a
// card's line count stays consistent from one document to the next
// instead of shifting with how long a given title happens to be.
function previewLinesFitting(reservedHeight: number): number {
  const available =
    GRID_CARD_HEIGHT -
    reservedHeight -
    GRID_CONTENT_PADDING * 2 -
    GRID_TITLE_LINE_HEIGHT * GRID_TITLE_MAX_LINES -
    GRID_CONTENT_GAP -
    GRID_DATE_LINE_HEIGHT;
  return Math.max(1, Math.floor(available / GRID_PREVIEW_LINE_HEIGHT));
}

// No image: gridContent fills the entire card, nothing reserved.
const EXPANDED_TEXT_LINES = previewLinesFitting(0);
// With one: reserves the thumbnail's own height plus its 1px bottom
// border (see thumbGrid) - noticeably fewer lines fit, which is exactly
// why this needed computing separately rather than reusing one constant
// for both cases.
const THUMB_BORDER_WIDTH = 1;
const COMPACT_TEXT_LINES = previewLinesFitting(GRID_THUMB_HEIGHT + THUMB_BORDER_WIDTH);

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
// the plain text snippet - a card only ever shows one of these three, not
// a mix, and each is capped to what extractPreview already trimmed it to.
function PreviewBody({
  checklistItems,
  imageUris,
  previewText,
  bodyMatch,
  textColor,
  mutedColor,
  compact,
  textLines = 2,
}: {
  checklistItems: PreviewChecklistItem[];
  imageUris: string[];
  previewText: string;
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
  if (checklistItems.length > 0) {
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
      </View>
    );
  }
  if (imageUris.length > 1) {
    return (
      <View style={styles.photoStrip}>
        {imageUris.slice(0, compact ? 3 : 4).map((uri, index) => (
          <Image key={index} source={{ uri }} style={styles.photoStripItem} resizeMode="cover" />
        ))}
      </View>
    );
  }
  if (bodyMatch) {
    return (
      <HighlightedLine
        match={bodyMatch}
        style={[compact ? styles.previewCompact : styles.preview, { color: mutedColor }]}
        highlightStyle={styles.highlight}
        numberOfLines={textLines}
      />
    );
  }
  if (!previewText) return null;
  return (
    <Text style={[compact ? styles.previewCompact : styles.preview, { color: mutedColor }]} numberOfLines={textLines}>
      {previewText}
    </Text>
  );
}

type Props = {
  id: string;
  title: string;
  updatedAt: number;
  imageUri: string | null;
  previewText: string;
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
  onPress: () => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  // 'list' (default) is the original wide row. 'grid' is a compact square
  // card for DocumentsScreen's 2-column view - thumbnail on top instead of
  // beside the text, smaller type, select-checkbox as a corner overlay
  // instead of a trailing icon (a grid card has no natural trailing edge
  // the way a full-width row does).
  layout?: 'list' | 'grid';
};

// The card shared by Documents and Search: a thumbnail (the document's
// first image block, or a plain placeholder box with a document icon when
// it has none), title, a live content preview, and the last-edited
// timestamp.
//
// The card's fill color comes from `colorForDocument(id)` - a fixed palette
// picked deterministically from the document's own id (see that file for
// why it isn't a random pick or a stored field), with the text/border/
// delete-icon colors all derived to stay readable against whichever fill a
// given document landed on.
export default function DocumentCard({
  id,
  title,
  updatedAt,
  imageUri,
  previewText,
  imageUris = [],
  checklistItems = [],
  titleMatch,
  bodyMatch,
  onPress,
  isSelectMode,
  isSelected,
  onToggleSelect,
  layout = 'list',
}: Props) {
  const { background, text, textMuted } = colorForDocument(id);
  const isGrid = layout === 'grid';
  // A list row keeps its own square placeholder regardless (a small
  // thumbnail beside text reads as "no photo yet", not as reserved cover
  // space) - only the grid card's top-of-card image slot goes away
  // entirely when there's nothing to show there, reclaiming that height
  // for more preview text instead.
  const noImage = isGrid && !imageUri;

  const titleNode = titleMatch ? (
    <HighlightedLine
      match={titleMatch}
      style={[isGrid ? styles.titleCompact : styles.title, { color: text }]}
      highlightStyle={styles.highlight}
    />
  ) : (
    <Text style={[isGrid ? styles.titleCompact : styles.title, { color: text }]} numberOfLines={2}>
      {title || 'Без назви'}
    </Text>
  );

  const thumbNode = imageUri ? (
    <Image source={{ uri: imageUri }} style={isGrid ? styles.thumbGrid : styles.thumb} resizeMode="cover" />
  ) : noImage ? null : ( // list layout only past this point - a grid card with no image is null, not a placeholder
    <View style={[styles.thumb, styles.thumbPlaceholder]}>
      <Ionicons name="document-text-outline" size={22} color="#D1D5DB" />
    </View>
  );

  const previewBody = (
    <PreviewBody
      checklistItems={checklistItems}
      imageUris={imageUris}
      previewText={previewText}
      bodyMatch={bodyMatch}
      textColor={text}
      mutedColor={textMuted}
      compact={isGrid}
      textLines={isGrid ? (noImage ? EXPANDED_TEXT_LINES : COMPACT_TEXT_LINES) : 2}
    />
  );

  const selectIcon = isSelectMode && (
    <Ionicons
      name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
      size={22}
      color={isSelected ? text : textMuted}
    />
  );

  if (isGrid) {
    return (
      <View style={[styles.gridCard, { backgroundColor: background }]}>
        <Image source={GRAIN} resizeMode="repeat" style={styles.grain} />
        <Pressable style={styles.gridTap} onPress={isSelectMode ? onToggleSelect : onPress}>
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
            <Text style={[styles.dateCompact, styles.dateCompactPinned, { color: textMuted }]}>
              {formatUpdatedAt(updatedAt)}
            </Text>
          </View>
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
    <View style={[styles.row, { backgroundColor: background }]}>
      <Image source={GRAIN} resizeMode="repeat" style={styles.grain} />
      <Pressable style={styles.tap} onPress={isSelectMode ? onToggleSelect : onPress}>
        {thumbNode}
        <View style={styles.body}>
          {titleNode}
          {previewBody}
          <Text style={[styles.date, { color: textMuted }]}>{formatUpdatedAt(updatedAt)}</Text>
        </View>
        {isSelectMode && <View style={styles.selectBox}>{selectIcon}</View>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  grain: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    // The card's own overflow: 'hidden' clips this to its corners.
    opacity: 0.055,
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
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
  },
  preview: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT_REGULAR,
  },
  highlight: {
    backgroundColor: '#FEF08A',
    color: '#111827',
  },
  date: {
    fontSize: 12,
    marginTop: 2,
    fontFamily: FONT_REGULAR,
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
    fontSize: 13,
    fontFamily: FONT_REGULAR,
  },
  checklistTextCompact: {
    flex: 1,
    fontSize: 10.5,
    fontFamily: FONT_REGULAR,
  },
  checklistTextDone: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
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
    // whatever's left in its row, which is fine with 2 cards (~half each)
    // but means a row with only ONE card (e.g. a filter down to a single
    // result) stretches it across the full width instead of keeping the
    // usual half-width tile size.
    width: '48%',
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
  titleCompact: {
    fontSize: 13,
    // Explicit, matching GRID_TITLE_LINE_HEIGHT above - EXPANDED_TEXT_LINES
    // is computed against this exact number, not whatever this font's own
    // default metric happens to be.
    lineHeight: 17,
    // Matches GRID_CONTENT_GAP - the one fixed gap in this layout (see its
    // own comment).
    marginBottom: 4,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
  },
  previewCompact: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: FONT_REGULAR,
  },
  dateCompact: {
    fontSize: 10,
    // Explicit, matching GRID_DATE_LINE_HEIGHT above - see titleCompact's
    // identical reasoning. marginTop here is always overridden by
    // dateCompactPinned's own 'auto' (this style is only ever used in the
    // grid layout, combined with that one) - kept rather than removed
    // since it's harmless and this is what a non-pinned instance would
    // fall back to.
    lineHeight: 13,
    marginTop: 2,
    fontFamily: FONT_REGULAR,
  },
  dateCompactPinned: {
    marginTop: 'auto',
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
