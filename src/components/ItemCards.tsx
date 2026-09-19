import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRecordColour } from '../theme/ThemeProvider';
import { Ionicons } from '@expo/vector-icons';
import { Tag } from '../types';
import TagChips from './TagChips';
import { formatAddedOn, formatUpdatedAt } from '../utils/documentPreview';
import { useFilePreview } from '../hooks/useFilePreview';
import { useAttachmentSource } from '../hooks/useAttachmentSource';
import AttachmentImage from './AttachmentImage';
import { LINK_CATEGORY_INFO, categoryFromSiteName } from '../utils/linkCategory';
import { fileIconColorFor, fileIconFor } from '../utils/fileIcons';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// The cards themselves, out of the screens that used to own them. A photo,
// a file or a link is now drawn in two places - in its own database, and
// under the divider in a group's section on any other one - and the two
// have to be the same card, not a lookalike.
//
// Everything a card does is a prop: no card knows about select mode,
// pickers or navigation. Leave onMenu and onTagPress out and it draws
// itself read-only, which is what a group's section wants.

// How many cells stand across one row. The width is still FLEX - a
// percentage basis, never a measured number, which is the rule that cost
// four attempts at the deformed cards - so this only chooses which basis.
// Two on a phone; three where the column is wide enough to hold them (the
// fold open, a tablet, the browser).
export function gridBasis(columns: number) {
  return columns >= 3 ? ('30%' as const) : ('46%' as const);
}

type Common = {
  tags: Tag[];
  // The card's own node, handed to whatever needs to measure it - the
  // carry gesture asks what is under the finger (see useCardCarry), and a
  // card is the answer. It goes on the card's OWN root and not on a
  // wrapper around it, because these cards are flex items: a wrapper
  // takes that role for itself, and the card inside it, now laid out in a
  // column, reads its own flexBasis as a HEIGHT. That is what stopped the
  // tiles being draggable and would have deformed them next.
  cardRef?: (node: View | null) => void;
  // Being carried right now - the card stays where it is and fades, the
  // ghost under the finger is the thing in hand.
  dimmed?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onMenu?: () => void;
  onTagPress?: () => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
};

export type LinkCardItem = {
  id: string;
  url: string;
  title?: string;
  siteName?: string;
  imageUrl?: string;
  tagIds: string[];
  createdAt?: number;
  updatedAt?: number;
};

export type FileCardItem = {
  id: string;
  fileName: string;
  // Where the bytes are on this device - what the preview is made from.
  fileUri?: string;
  title?: string;
  tagIds: string[];
  // When it was added - shown on the card, because "which of these is the
  // one from Monday" is the question a list of similar file names gets
  // asked most.
  createdAt?: number;
  updatedAt?: number;
};

export type PhotoCardItem = {
  id: string;
  imageUri: string;
  driveFileId?: string;
  documentIds: string[];
  tagIds: string[];
  // Only the row view shows these - a grid cell is the picture and
  // nothing else, which is the point of a grid.
  title?: string;
  createdAt?: number;
  updatedAt?: number;
};

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function Trailing({
  isSelectMode,
  isSelected,
  onToggleSelect,
  onMenu,
  text,
  textMuted,
}: {
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onMenu?: () => void;
  text: string;
  textMuted: string;
}) {
  if (isSelectMode) {
    return (
      <Pressable hitSlop={8} onPress={onToggleSelect} style={styles.rowActionButton}>
        <Ionicons
          name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={isSelected ? text : textMuted}
        />
      </Pressable>
    );
  }
  if (!onMenu) return null;
  return (
    <Pressable hitSlop={8} onPress={onMenu} style={styles.rowActionButton}>
      <Ionicons name="ellipsis-horizontal" size={16} color={textMuted} />
    </Pressable>
  );
}

export function LinkRow({ link, ...rest }: { link: LinkCardItem } & Common) {
  const recordColour = useRecordColour();
  const info = LINK_CATEGORY_INFO[categoryFromSiteName(link.siteName)];
  const { background, text, textMuted } = recordColour(link.id);
  return (
    <View ref={rest.cardRef} collapsable={false} style={[styles.row, { backgroundColor: background }, rest.dimmed && styles.dimmed]}>
      <Pressable style={styles.rowTap} onPress={rest.onPress} onLongPress={rest.onLongPress}>
        {link.imageUrl ? (
          <Image source={{ uri: link.imageUrl }} style={styles.rowThumbWide} resizeMode="cover" resizeMethod="resize" />
        ) : (
          <View style={[styles.rowThumbWide, styles.thumbIconWindow, { backgroundColor: `${info.color}1A` }]}>
            <Ionicons name={info.icon} size={22} color={info.color} />
          </View>
        )}
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2}>
            {link.title || hostnameOf(link.url)}
          </Text>
          <Text style={[styles.rowCaption, { color: textMuted }]} numberOfLines={1}>
            {link.siteName ?? hostnameOf(link.url)}
            {!!(link.createdAt ?? link.updatedAt) &&
              ` · ${formatUpdatedAt((link.createdAt ?? link.updatedAt) as number)}`}
          </Text>
          {rest.tags.length > 0 && (
            <View style={styles.rowMeta}>
              <TagChips tags={rest.tags} onPress={rest.onTagPress ?? (() => {})} glass />
            </View>
          )}
        </View>
      </Pressable>
      <Trailing {...rest} text={text} textMuted={textMuted} />
    </View>
  );
}

// A card's height follows its width, so a row of them is a row of the same
// shape. Without it each card was as tall as its own title and tags, and a
// wrapped row came out ragged - which is what the user has been calling
// deformed.
//
// It is an aspectRatio, NOT a height worked out from a measured width.
// That is the whole history of this bug: the width came from a number
// the screen had measured, the height was that same number times the
// ratio - and where the two disagreed (a pane whose real row is
// narrower than the measurement said) flex shrank the width and left
// the height where it was, which is the tall narrow strip the user kept
// being shown. An aspectRatio is resolved from the width the card
// ACTUALLY gets, so the two can never disagree again.
export const GRID_CARD_RATIO = 1.3;

export function LinkGridCell({ link, columns = 2, ...rest }: { link: LinkCardItem } & Common & { columns?: number }) {
  const recordColour = useRecordColour();
  const info = LINK_CATEGORY_INFO[categoryFromSiteName(link.siteName)];
  const { background, text, textMuted } = recordColour(link.id);
  return (
    <View
      ref={rest.cardRef}
      collapsable={false}
      style={[
        styles.gridCard,
        { backgroundColor: background, flexBasis: gridBasis(columns) },
      ,
        rest.dimmed && styles.dimmed,
      ]}
    >
      <Pressable style={styles.gridTap} onPress={rest.onPress} onLongPress={rest.onLongPress}>
        {link.imageUrl ? (
          <Image source={{ uri: link.imageUrl }} style={styles.gridThumb} resizeMode="cover" resizeMethod="resize" />
        ) : (
          <View style={[styles.gridThumb, styles.gridThumbIcon, { backgroundColor: `${info.color}1A` }]}>
            <Ionicons name={info.icon} size={26} color={info.color} />
          </View>
        )}
        <Text style={[styles.gridTitle, { color: text }]} numberOfLines={2}>
          {link.title || hostnameOf(link.url)}
        </Text>
        <Text style={[styles.gridCaption, { color: textMuted }]} numberOfLines={1}>
          {link.siteName ?? hostnameOf(link.url)}
        </Text>
        {rest.tags.length > 0 && (
          <View style={styles.rowMeta}>
            <TagChips tags={rest.tags} onPress={rest.onTagPress ?? (() => {})} glass />
          </View>
        )}
      </Pressable>
      <View style={styles.gridTrailing}>
        <Trailing {...rest} text={text} textMuted={textMuted} />
      </View>
    </View>
  );
}

export function FileRow({ file, ...rest }: { file: FileCardItem } & Common) {
  const recordColour = useRecordColour();
  const { background, text, textMuted } = recordColour(file.id);
  // What is actually inside it - the first page of a PDF, the first lines
  // of a document. Worked out once, elsewhere (see FilePreviewWorker).
  const preview = useFilePreview(file);

  return (
    <View ref={rest.cardRef} collapsable={false} style={[styles.row, { backgroundColor: background }, rest.dimmed && styles.dimmed]}>
      <Pressable style={styles.rowTap} onPress={rest.onPress} onLongPress={rest.onLongPress}>
        {/* The page picture at a video thumbnail's size - wide enough to
            recognise the document by its shape, small enough to leave the
            name room. Blown up to the full width it was still not
            readable, so the space was spent on nothing. */}
        {preview?.thumbUri ? (
          <Image source={{ uri: preview.thumbUri }} style={styles.rowThumbWide} resizeMode="cover" resizeMethod="resize" />
        ) : (
          // The same window, whatever the file is: a row of cards whose
          // pictures are different shapes reads as a broken grid, and an
          // icon centred in that window says "nothing to show" without
          // moving anything.
          <View
            style={[
              styles.rowThumbWide,
              styles.thumbIconWindow,
              { backgroundColor: `${fileIconColorFor(file.fileName)}1A` },
            ]}
          >
            <Ionicons name={fileIconFor(file.fileName)} size={22} color={fileIconColorFor(file.fileName)} />
          </View>
        )}
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2}>
            {file.title || file.fileName}
          </Text>
          {!!preview?.text && (
            <Text style={[styles.rowCaption, { color: textMuted }]} numberOfLines={2}>
              {preview.text}
            </Text>
          )}
          {!!(file.createdAt ?? file.updatedAt) && (
            <Text style={[styles.rowCaption, { color: textMuted }]}>
              {formatUpdatedAt((file.createdAt ?? file.updatedAt) as number)}
            </Text>
          )}
          {rest.tags.length > 0 && (
            <View style={styles.rowMeta}>
              <TagChips tags={rest.tags} onPress={rest.onTagPress ?? (() => {})} glass />
            </View>
          )}
        </View>
      </Pressable>
      <Trailing {...rest} text={text} textMuted={textMuted} />
    </View>
  );
}

export function FileGridCell({ file, columns = 2, ...rest }: { file: FileCardItem } & Common & { columns?: number }) {
  const recordColour = useRecordColour();
  const { background, text, textMuted } = recordColour(file.id);
  const preview = useFilePreview(file);
  return (
    <View
      ref={rest.cardRef}
      collapsable={false}
      style={[
        styles.gridCard,
        { backgroundColor: background, flexBasis: gridBasis(columns) },
      ,
        rest.dimmed && styles.dimmed,
      ]}
    >
      <Pressable style={styles.gridTap} onPress={rest.onPress} onLongPress={rest.onLongPress}>
        {preview?.thumbUri ? (
          <Image source={{ uri: preview.thumbUri }} style={styles.gridThumb} resizeMode="cover" resizeMethod="resize" />
        ) : preview?.text ? (
          // No picture to make from a document, but its own first lines
          // say more than an icon of a page does - in the same window.
          <View style={[styles.gridThumb, styles.gridTextPreview]}>
            <Text style={[styles.gridTextPreviewLabel, { color: textMuted }]} numberOfLines={4}>
              {preview.text}
            </Text>
          </View>
        ) : (
          <View
            style={[styles.gridThumb, styles.gridThumbIcon, { backgroundColor: `${fileIconColorFor(file.fileName)}1A` }]}
          >
            <Ionicons name={fileIconFor(file.fileName)} size={26} color={fileIconColorFor(file.fileName)} />
          </View>
        )}
        <Text style={[styles.gridTitle, { color: text }]} numberOfLines={2}>
          {file.title || file.fileName}
        </Text>
        {!!(file.createdAt ?? file.updatedAt) && (
          <Text style={[styles.gridCaption, { color: textMuted }]}>
            {formatUpdatedAt((file.createdAt ?? file.updatedAt) as number)}
          </Text>
        )}
        {rest.tags.length > 0 && (
          <View style={styles.rowMeta}>
            <TagChips tags={rest.tags} onPress={rest.onTagPress ?? (() => {})} glass />
          </View>
        )}
      </Pressable>
      <View style={styles.gridTrailing}>
        <Trailing {...rest} text={text} textMuted={textMuted} />
      </View>
    </View>
  );
}

// A photo as a row, beside the grid it has always had.
//
// The grid answers "which one" by sight and says nothing else; this
// answers the questions a grid cannot - what it is CALLED, when it was
// added, which tags it carries - and it is the only view in which a
// photo's name is visible at all outside its own rename dialog.
//
// Built on the same row as files and links rather than a shape of its
// own: same thumbnail window, same title/caption stack, same trailing
// control. A photo is not a different kind of thing to a file here.
export function PhotoRow({ photo, ...rest }: { photo: PhotoCardItem } & Common) {
  const recordColour = useRecordColour();
  const { background, text, textMuted } = recordColour(photo.id);
  // Through useAttachmentSource, not useCachedAttachment: it answers with
  // an address rather than only a verdict, which is what a browser needs
  // and what the phone gets for free. A thumbnail in a list is not
  // someone looking at the photo, hence the false.
  const { status, source } = useAttachmentSource(photo.imageUri, photo.driveFileId, false);
  const docCount = photo.documentIds.length;

  return (
    <View ref={rest.cardRef} collapsable={false} style={[styles.row, { backgroundColor: background }, rest.dimmed && styles.dimmed]}>
      <Pressable style={styles.rowTap} onPress={rest.onPress} onLongPress={rest.onLongPress}>
        {status === 'ready' ? (
          <Image source={{ uri: source ?? photo.imageUri }} style={styles.rowThumbWide} resizeMode="cover" resizeMethod="resize" />
        ) : (
          <View style={[styles.rowThumbWide, styles.thumbIconWindow, { backgroundColor: 'rgba(236,72,153,0.10)' }]}>
            {status === 'missing' ? (
              <Ionicons name="cloud-offline-outline" size={22} color="#9CA3AF" />
            ) : (
              <ActivityIndicator color="#9CA3AF" />
            )}
          </View>
        )}
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2}>
            {photo.title || 'Без назви'}
          </Text>
          {!!(photo.createdAt ?? photo.updatedAt) && (
            <Text style={[styles.rowCaption, { color: textMuted }]}>
              {formatAddedOn((photo.createdAt ?? photo.updatedAt) as number, true)}
            </Text>
          )}
          {docCount > 0 && (
            <Text style={[styles.rowCaption, { color: textMuted }]}>
              {docCount === 1 ? 'В одній нотатці' : `У нотатках: ${docCount}`}
            </Text>
          )}
          {rest.tags.length > 0 && (
            <View style={styles.rowMeta}>
              {/* One folder's name and a count of the rest - the user's
                  own rule for a card. */}
              <TagChips tags={rest.tags} onPress={rest.onTagPress ?? (() => {})} glass max={1} />
            </View>
          )}
        </View>
      </Pressable>
      <Trailing {...rest} text={text} textMuted={textMuted} />
    </View>
  );
}

export function PhotoCell({ photo, ...rest }: { photo: PhotoCardItem } & Common) {
  // This device may never have had the actual bytes (a fresh install, a
  // different device than the one the photo was taken on) - quietly
  // re-pulled from the Drive backup the first time it is rendered.
  // A thumbnail in the grid is not someone looking at the photo.
  const docCount = photo.documentIds.length;
  return (
    <Pressable
      ref={rest.cardRef}
      collapsable={false}
      style={[styles.cell, rest.dimmed && styles.dimmed]}
      onPress={rest.onPress}
      onLongPress={rest.onLongPress}
    >
      {/* The grid was the last place in the Photos database still
          drawing the phone's path directly - see AttachmentImage. */}
      <AttachmentImage uri={photo.imageUri} driveFileId={photo.driveFileId} style={styles.cellImage} />
      {rest.isSelectMode ? (
        <View style={styles.cellCheckbox}>
          <Ionicons
            name={rest.isSelected ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={rest.isSelected ? '#EC4899' : '#fff'}
          />
        </View>
      ) : (
        // The same three facts the row carries - when it was added, how
        // many notes use it, and which folder it is in - on a scrim
        // along the foot of the picture, so a grid cell says as much as
        // a row without stopping being a picture.
        <View style={styles.cellFooter} pointerEvents="box-none">
          <View style={styles.cellFacts}>
            {!!(photo.createdAt ?? photo.updatedAt) && (
              <Text style={styles.cellFactLabel} numberOfLines={1}>
                {formatAddedOn((photo.createdAt ?? photo.updatedAt) as number)}
              </Text>
            )}
            {docCount > 0 && (
              <>
                <Ionicons name="document-text-outline" size={11} color="rgba(255,255,255,0.8)" />
                <Text style={styles.cellFactLabel}>{docCount}</Text>
              </>
            )}
          </View>
          {rest.tags.length > 0 && (
            <View style={styles.cellTagRow}>
              <TagChips tags={rest.tags} onPress={rest.onTagPress ?? (() => {})} glass max={1} />
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A card whose item is in hand right now.
  dimmed: {
    opacity: 0.4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    borderRadius: 14,
    padding: 10,
    // Thin border + drop shadow, same as DocumentCard - a light-coloured
    // card needs an edge to read against the gradient page behind it.
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  rowTap: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
  },
  // A video thumbnail's proportion, at a size a row can carry. Every file
  // gets this window - with its page picture in it, or its icon.
  rowThumbWide: {
    width: 104,
    aspectRatio: 16 / 9,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
  },
  thumbIconWindow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rowTitle: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
  },
  rowCaption: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  rowActionButton: {
    padding: 6,
  },
  gridCard: {
    overflow: 'hidden',
    // Two to a line, whatever the line turns out to be. flexBasis 46 and
    // grow 1: the pair starts under half each, so the row's own 12pt gap
    // always fits, and then they grow to share exactly what is left. No
    // screen has to measure anything and hand a number down - which is
    // what every version of this card being "deformed" came from.
    flexBasis: '46%',
    flexGrow: 1,
    aspectRatio: 1 / GRID_CARD_RATIO,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
    padding: 10,
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  gridTap: {
    gap: 4,
  },
  gridThumb: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 10,
    marginBottom: 4,
  },
  gridTextPreview: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    padding: 8,
    overflow: 'hidden',
  },
  gridTextPreviewLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontFamily: FONT_REGULAR,
  },
  gridThumbIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridTitle: {
    fontSize: 13,
    fontFamily: FONT_BOLD,
  },
  gridCaption: {
    fontSize: 11,
    fontFamily: FONT_REGULAR,
  },
  gridTrailing: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  cell: {
    // Same rule as gridCard above: the pair fills whatever the row
    // really is, rather than a width measured somewhere else.
    flexBasis: '46%',
    flexGrow: 1,
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
  },
  cellImage: {
    width: '100%',
    height: '100%',
  },
  cellImageStatus: {
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellCheckbox: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  cellBadgeLabel: {
    fontSize: 11,
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
  // The foot of a picture: a dark band the facts can be read against,
  // whatever the photograph under it happens to be.
  cellFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 8,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  cellFacts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cellFactLabel: {
    fontSize: 11,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.88)',
  },
  cellTagRow: {},
});
