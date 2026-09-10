import { ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tag } from '../types';
import { RowDisplay } from '../utils/customRowDisplay';
import { colorForDocument } from '../utils/documentColor';
import { useCachedAttachment } from '../hooks/useCachedAttachment';
import { FIELD_TYPE_ICON } from './FieldsEditorSheet';
import TagChips from './TagChips';

// A square thumbnail for a resolved relation target - same
// checking/ready/missing states as PhotosScreen's own PhotoThumb, without
// the tag row/select-mode chrome that only makes sense on that grid.
export function RelationThumb({
  uri,
  driveFileId,
  size,
  radius = 6,
  fill,
}: {
  uri: string;
  driveFileId?: string;
  // Ignored when `fill` is set - the thumbnail then takes its parent's
  // size instead, which is what a grid tile's cover needs (a fixed square
  // would just be cropped by the tile rather than scaled to it).
  size?: number;
  radius?: number;
  fill?: boolean;
}) {
  const status = useCachedAttachment(uri, driveFileId);
  return (
    <View
      style={[
        styles.thumbWrap,
        fill ? styles.thumbFill : { width: size, height: size, borderRadius: radius },
      ]}
    >
      {status === 'ready' ? (
        <Image source={{ uri }} style={styles.thumbImage} resizeMode="cover" />
      ) : (
        <View style={[styles.thumbImage, styles.thumbStatus]}>
          {status === 'missing' ? (
            <Ionicons name="cloud-offline-outline" size={Math.round((size ?? 48) * 0.45)} color="#9CA3AF" />
          ) : (
            <ActivityIndicator color="#9CA3AF" size="small" />
          )}
        </View>
      )}
    </View>
  );
}

type Props = {
  // Only used to pick the card's colour, so the same row keeps the same
  // shade everywhere it appears (its own database, a document, later the
  // board) - same colorForDocument every other card in the app uses.
  rowId: string;
  display: RowDisplay;
  tags: Tag[];
  onPress?: () => void;
  onTagPress?: () => void;
  // The trailing control - the select checkbox / "..." menu on the database
  // screen, nothing when the card is embedded elsewhere.
  right?: ReactNode;
};

// One custom-database row as a card. Deliberately one shared component
// rather than a copy per screen: it's rendered in its own database's list,
// as a block inside a document, and (later) as a board card - a redesign
// has to land in all three at once, which only a single component gives.
export default function CustomRowCard({ rowId, display, tags, onPress, onTagPress, right }: Props) {
  const { background, text, textMuted } = colorForDocument(rowId);
  return (
    <View style={[styles.row, { backgroundColor: background }]}>
      <Pressable style={styles.rowTap} onPress={onPress} disabled={!onPress}>
        {display.cover !== undefined &&
          (display.cover?.thumbUri ? (
            <RelationThumb uri={display.cover.thumbUri} driveFileId={display.cover.driveFileId} size={56} radius={12} />
          ) : (
            <View style={styles.coverPlaceholder}>
              <Ionicons name="image-outline" size={20} color="#9CA3AF" />
            </View>
          ))}
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2}>
            {display.title}
          </Text>
          {display.chips.length > 0 && (
            <View style={styles.rowFieldChips}>
              {display.chips.map(({ field, shown }) => (
                <View key={field.id} style={styles.rowFieldChip}>
                  <Ionicons name={FIELD_TYPE_ICON[field.type]} size={11} color={textMuted} />
                  <Text style={[styles.rowFieldChipValue, { color: textMuted }]} numberOfLines={1}>
                    {shown}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {tags.length > 0 && (
            <View style={styles.rowMeta}>
              <TagChips tags={tags} onPress={onTagPress ?? onPress ?? (() => {})} glass />
            </View>
          )}
        </View>
      </Pressable>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    borderRadius: 14,
    padding: 10,
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
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    justifyContent: 'center',
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowFieldChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 2,
  },
  rowFieldChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
  },
  rowFieldChipValue: {
    fontSize: 12,
    flexShrink: 1,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  coverPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbWrap: {
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
  },
  thumbFill: {
    width: '100%',
    height: '100%',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbStatus: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// The same row as a grid tile: the cover image is the whole point of this
// view (it's what the cover field exists for), so it leads, with the
// title and a couple of values under it. A database with no cover field
// still works - the tile just carries text, on the row's own colour.
export function CustomRowGridCard({
  rowId,
  display,
  onPress,
  onLongPress,
  right,
}: {
  rowId: string;
  display: RowDisplay;
  onPress?: () => void;
  onLongPress?: () => void;
  right?: ReactNode;
}) {
  const { background, text, textMuted } = colorForDocument(rowId);
  const hasCover = display.cover !== undefined;
  return (
    <Pressable
      style={[gridStyles.tile, { backgroundColor: background }]}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
    >
      {hasCover &&
        (display.cover?.thumbUri ? (
          <View style={gridStyles.coverWrap}>
            <RelationThumb uri={display.cover.thumbUri} driveFileId={display.cover.driveFileId} fill />
          </View>
        ) : (
          <View style={[gridStyles.coverWrap, gridStyles.coverEmpty]}>
            <Ionicons name="image-outline" size={26} color="rgba(255,255,255,0.5)" />
          </View>
        ))}
      <View style={gridStyles.body}>
        <Text style={[gridStyles.title, { color: text }]} numberOfLines={2}>
          {display.title}
        </Text>
        {display.chips.slice(0, 3).map(({ field, shown }) => (
          <View key={field.id} style={gridStyles.chip}>
            <Ionicons name={FIELD_TYPE_ICON[field.type]} size={11} color={textMuted} />
            <Text style={[gridStyles.chipValue, { color: textMuted }]} numberOfLines={1}>
              {shown}
            </Text>
          </View>
        ))}
      </View>
      {right !== undefined && <View style={gridStyles.corner}>{right}</View>}
    </Pressable>
  );
}

const gridStyles = StyleSheet.create({
  tile: {
    width: '47%',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  coverWrap: {
    width: '100%',
    aspectRatio: 1,
    overflow: 'hidden',
  },
  coverEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  body: {
    padding: 10,
    gap: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chipValue: {
    fontSize: 12,
    flexShrink: 1,
  },
  corner: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
});
