import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TextMatch, formatUpdatedAt } from '../utils/documentPreview';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';
const THUMB_SIZE = 72;

function HighlightedLine({ match, style, highlightStyle }: { match: TextMatch; style: object; highlightStyle: object }) {
  return (
    <Text style={style} numberOfLines={2}>
      {match.before}
      <Text style={highlightStyle}>{match.match}</Text>
      {match.after}
    </Text>
  );
}

type Props = {
  title: string;
  updatedAt: number;
  imageUri: string | null;
  previewText: string;
  // When set (a search match), the title or preview line renders with the
  // matched substring highlighted instead of the plain text - see
  // SearchScreen. DocumentsScreen's own list never sets these.
  titleMatch?: TextMatch | null;
  bodyMatch?: TextMatch | null;
  onPress: () => void;
  onDelete?: () => void;
};

// The list-row card shared by Documents and Search: a thumbnail (the
// document's first image block, or a plain placeholder box with a document
// icon when it has none), title, a two-line preview of the body text (or a
// highlighted search-match snippet in its place), and the last-edited
// timestamp.
export default function DocumentCard({ title, updatedAt, imageUri, previewText, titleMatch, bodyMatch, onPress, onDelete }: Props) {
  return (
    <View style={styles.row}>
      <Pressable style={styles.tap} onPress={onPress}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="document-text-outline" size={22} color="#D1D5DB" />
          </View>
        )}
        <View style={styles.body}>
          {titleMatch ? (
            <HighlightedLine match={titleMatch} style={styles.title} highlightStyle={styles.highlight} />
          ) : (
            <Text style={styles.title} numberOfLines={2}>
              {title || 'Без назви'}
            </Text>
          )}
          {bodyMatch ? (
            <HighlightedLine match={bodyMatch} style={styles.preview} highlightStyle={styles.highlight} />
          ) : (
            !!previewText && (
              <Text style={styles.preview} numberOfLines={2}>
                {previewText}
              </Text>
            )
          )}
          <Text style={styles.date}>{formatUpdatedAt(updatedAt)}</Text>
        </View>
      </Pressable>
      {onDelete && (
        <Pressable hitSlop={8} onPress={onDelete} style={styles.deleteButton}>
          <Ionicons name="trash-outline" size={20} color={DANGER} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 8,
  },
  tap: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
  },
  thumbPlaceholder: {
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
    color: '#111827',
  },
  preview: {
    fontSize: 13,
    color: '#9CA3AF',
    lineHeight: 18,
  },
  highlight: {
    backgroundColor: '#FEF08A',
    color: '#111827',
  },
  date: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  deleteButton: {
    padding: 4,
    marginTop: 4,
  },
});
