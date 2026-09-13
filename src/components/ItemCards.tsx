import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tag } from '../types';
import TagChips from './TagChips';
import { colorForDocument } from '../utils/documentColor';
import { formatUpdatedAt } from '../utils/documentPreview';
import { useFilePreview } from '../hooks/useFilePreview';
import { useCachedAttachment } from '../hooks/useCachedAttachment';
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

type Common = {
  tags: Tag[];
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
  const info = LINK_CATEGORY_INFO[categoryFromSiteName(link.siteName)];
  const { background, text, textMuted } = colorForDocument(link.id);
  return (
    <View style={[styles.row, { backgroundColor: background }]}>
      <Pressable style={styles.rowTap} onPress={rest.onPress} onLongPress={rest.onLongPress}>
        {link.imageUrl ? (
          <Image source={{ uri: link.imageUrl }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumbIcon, { backgroundColor: `${info.color}1A` }]}>
            <Ionicons name={info.icon} size={20} color={info.color} />
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

export function LinkGridCell({ link, ...rest }: { link: LinkCardItem } & Common) {
  const info = LINK_CATEGORY_INFO[categoryFromSiteName(link.siteName)];
  const { background, text, textMuted } = colorForDocument(link.id);
  return (
    <View style={[styles.gridCard, { backgroundColor: background }]}>
      <Pressable style={styles.gridTap} onPress={rest.onPress} onLongPress={rest.onLongPress}>
        {link.imageUrl ? (
          <Image source={{ uri: link.imageUrl }} style={styles.gridThumb} resizeMode="cover" />
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
  const { background, text, textMuted } = colorForDocument(file.id);
  // What is actually inside it - the first page of a PDF, the first lines
  // of a document. Worked out once, elsewhere (see FilePreviewWorker).
  const preview = useFilePreview(file);
  return (
    <View style={[styles.row, { backgroundColor: background }]}>
      <Pressable style={styles.rowTap} onPress={rest.onPress} onLongPress={rest.onLongPress}>
        {preview?.thumbUri ? (
          <Image source={{ uri: preview.thumbUri }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumbIcon, { backgroundColor: `${fileIconColorFor(file.fileName)}1A` }]}>
            <Ionicons name={fileIconFor(file.fileName)} size={20} color={fileIconColorFor(file.fileName)} />
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

export function FileGridCell({ file, ...rest }: { file: FileCardItem } & Common) {
  const { background, text, textMuted } = colorForDocument(file.id);
  const preview = useFilePreview(file);
  return (
    <View style={[styles.gridCard, { backgroundColor: background }]}>
      <Pressable style={styles.gridTap} onPress={rest.onPress} onLongPress={rest.onLongPress}>
        {preview?.thumbUri ? (
          <Image source={{ uri: preview.thumbUri }} style={styles.gridThumb} resizeMode="cover" />
        ) : preview?.text ? (
          // No picture to make from a document, but its own first lines
          // say more than an icon of a page does.
          <View style={[styles.gridThumb, styles.gridTextPreview]}>
            <Text style={[styles.gridTextPreviewLabel, { color: textMuted }]} numberOfLines={5}>
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

export function PhotoCell({ photo, ...rest }: { photo: PhotoCardItem } & Common) {
  // This device may never have had the actual bytes (a fresh install, a
  // different device than the one the photo was taken on) - quietly
  // re-pulled from the Drive backup the first time it is rendered.
  // A thumbnail in the grid is not someone looking at the photo.
  const cacheStatus = useCachedAttachment(photo.imageUri, photo.driveFileId, false);
  const docCount = photo.documentIds.length;
  return (
    <Pressable style={styles.cell} onPress={rest.onPress} onLongPress={rest.onLongPress}>
      {cacheStatus === 'ready' ? (
        <Image source={{ uri: photo.imageUri }} style={styles.cellImage} resizeMode="cover" />
      ) : (
        <View style={[styles.cellImage, styles.cellImageStatus]}>
          {cacheStatus === 'missing' ? (
            <Ionicons name="cloud-offline-outline" size={22} color="#9CA3AF" />
          ) : (
            <ActivityIndicator color="#9CA3AF" />
          )}
        </View>
      )}
      {rest.isSelectMode ? (
        <View style={styles.cellCheckbox}>
          <Ionicons
            name={rest.isSelected ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={rest.isSelected ? '#EC4899' : '#fff'}
          />
        </View>
      ) : (
        <>
          {docCount > 1 && (
            <View style={styles.cellBadge}>
              <Text style={styles.cellBadgeLabel}>{docCount}</Text>
            </View>
          )}
          {rest.tags.length > 0 && (
            <View style={styles.cellTagRow}>
              <TagChips tags={rest.tags} onPress={rest.onTagPress ?? (() => {})} glass />
            </View>
          )}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
    // Fixed proportion, not flex:1 - a flex card stretches to fill
    // whatever is left in its row, which breaks when a row has only one
    // card left (a filter down to an odd count).
    width: '48%',
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
    height: 96,
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
    width: '47%',
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
  cellTagRow: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
  },
});
