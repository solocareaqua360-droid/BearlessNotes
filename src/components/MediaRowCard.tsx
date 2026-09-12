import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colorForDocument } from '../utils/documentColor';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

type Props = {
  // Only used to pick the card's colour (colorForDocument) - same
  // deterministic per-id palette Files/Photos/Links/CustomRowCard already
  // share, so the same record reads as the same card everywhere.
  id: string;
  title: string;
  caption?: string;
  // A photo/link card shows its own image; a file (nothing to preview)
  // falls back to an icon tile - same two-shape thumbnail Files/Links'
  // own row cards already use, just factored out so a photo history entry
  // (which had no card shape of its own before this) can share it too.
  thumbUri?: string;
  iconName?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  onPress: () => void;
};

// The Files/Links database row shape (thumbnail-or-icon, title, caption),
// pulled out on its own so it isn't reimplemented a third time for photos
// and a fourth time for the calendar's history list - both need exactly
// this card, and neither had a shared place to get it from before.
export default function MediaRowCard({ id, title, caption, thumbUri, iconName, iconColor, onPress }: Props) {
  const { background, text, textMuted } = colorForDocument(id);
  return (
    <Pressable style={[styles.row, { backgroundColor: background }]} onPress={onPress}>
      {thumbUri ? (
        <Image source={{ uri: thumbUri }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumbIcon, { backgroundColor: `${iconColor ?? '#6B7280'}1A` }]}>
          <Ionicons name={iconName ?? 'document-outline'} size={20} color={iconColor ?? '#6B7280'} />
        </View>
      )}
      <View style={styles.body}>
        <Text style={[styles.title, { color: text }]} numberOfLines={2}>
          {title}
        </Text>
        {!!caption && (
          <Text style={[styles.caption, { color: textMuted }]} numberOfLines={1}>
            {caption}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
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
  body: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
  },
  caption: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
  },
});
